#!/usr/bin/env node
import assert from 'node:assert/strict';

import { computeDiagnostics } from './diagnostics.js';
import { buildMetadataIndex, findMetadataAtText, formatMetadataItem, LSP_COMMANDS } from './metadata.js';
import { capText, containsPrivateKeyMaterial, deniedReason, readSafeTextFile, redactText, resolvePolicyPath, safeError } from './policy.js';
import { createCapabilities } from './capabilities.js';
import { runReadOnlyCommand } from './commands.js';
import { buildLspTelemetrySummary } from './telemetry.js';
import { codeLensesFor } from './code_lens.js';

type MinimalDocument = {
  uri: string;
  getText(): string;
};

async function main(): Promise<void> {
  const metadata = await buildMetadataIndex();
  assert(metadata.items.length > 0, 'metadata index should not be empty');
  assert(metadata.byId.has('command:nova.lsp.showSetupGuide'), 'setup command metadata missing');
  assert(metadata.byId.has('command:nova.lsp.showTelemetrySummary'), 'telemetry command metadata missing');
  assert(metadata.byId.has('policy:lsp-v1-1-client-setup'), 'client setup policy metadata missing');
  assert(metadata.byId.has('policy:lsp-v1-1-telemetry-summary'), 'telemetry summary policy metadata missing');
  assert(metadata.byId.has('mcp-tool:nova_mcp_capabilities'), 'source-derived MCP tool metadata missing');
  assert(metadata.byId.has('mcp-resource:nova://mcp/transport-readiness'), 'source-derived MCP resource metadata missing');
  assert(metadata.byId.has('mcp-prompt:nova_mcp_client_setup'), 'source-derived MCP prompt metadata missing');
  assert.equal(metadata.byId.get('mcp-tool:nova_write_file')?.readOnly, false, 'source-derived nova_write_file should remain non-read-only metadata');
  assert(metadata.byId.get('mcp-tool:nova_mcp_capabilities')?.tags?.includes('source-derived'), 'source-derived MCP tool should be tagged');
  for (const command of LSP_COMMANDS) {
    assert(metadata.byId.has(`command:${command}`), `command metadata missing for ${command}`);
  }

  const capabilities = createCapabilities();
  assert(!('workspaceEdit' in capabilities), 'WorkspaceEdit must not be advertised');
  assert(!('codeActionProvider' in capabilities), 'code actions must not be advertised');
  assert(Boolean(capabilities.codeLensProvider), 'read-only CodeLens provider should be advertised');
  const commands = capabilities.executeCommandProvider?.commands ?? [];
  assert(commands.includes('nova.lsp.showSetupGuide'), 'setup guide command missing from capabilities');
  assert(commands.every((command) => (LSP_COMMANDS as readonly string[]).includes(command)), 'capabilities include non-allowlisted LSP command');
  assert(commands.every((command) => !/write|bash|shell/i.test(command)), 'capabilities include write/shell command');

  const setup = runReadOnlyCommand({ command: 'nova.lsp.showSetupGuide', arguments: [] }, metadata) as { ok?: boolean; readOnly?: boolean; transport?: string; workspaceEdit?: boolean; writeCommands?: boolean; shellCommands?: boolean; validation?: string[] };
  assert.equal(setup.ok, true, 'setup command should succeed');
  assert.equal(setup.readOnly, true, 'setup command should be read-only');
  assert.equal(setup.transport, 'stdio', 'setup command should preserve stdio');
  assert.equal(setup.workspaceEdit, false, 'setup command must keep WorkspaceEdit disabled');
  assert.equal(setup.writeCommands, false, 'setup command must keep write commands disabled');
  assert.equal(setup.shellCommands, false, 'setup command must keep shell commands disabled');
  assert(setup.validation?.includes('npm run lsp:smoke'), 'setup command missing lsp smoke validation');
  assert(setup.validation?.includes('npm run eval:lsp'), 'setup command missing lsp eval validation');

  const telemetryDirect = buildLspTelemetrySummary(metadata, '2026-01-01T00:00:00.000Z');
  assert.equal(telemetryDirect.contentPolicy.documentContentIncluded, false, 'telemetry must omit document content');
  assert.equal(telemetryDirect.contentPolicy.rawDiagnosticsIncluded, false, 'telemetry must omit raw diagnostics');
  assert.equal(telemetryDirect.contentPolicy.uriIncluded, false, 'telemetry must omit URIs');
  assert.equal(telemetryDirect.contentPolicy.rootPathsIncluded, false, 'telemetry must omit root paths');
  assert.equal(telemetryDirect.contentPolicy.secretsIncluded, false, 'telemetry must omit secrets');
  assert.equal(telemetryDirect.server.transport, 'stdio', 'telemetry should preserve stdio posture');
  assert.equal(telemetryDirect.server.workspaceEdit, false, 'telemetry should preserve no WorkspaceEdit posture');
  assert.equal(telemetryDirect.metadata.commandCount, LSP_COMMANDS.length, 'telemetry command count mismatch');
  assert(telemetryDirect.validation.includes('npm run lsp:policy-smoke'), 'telemetry missing policy smoke validation');

  const telemetryCommand = runReadOnlyCommand({ command: 'nova.lsp.showTelemetrySummary', arguments: [] }, metadata) as { ok?: boolean; readOnly?: boolean; summary?: typeof telemetryDirect };
  assert.equal(telemetryCommand.ok, true, 'telemetry command should succeed');
  assert.equal(telemetryCommand.readOnly, true, 'telemetry command should be read-only');
  assert.equal(telemetryCommand.summary?.contentPolicy.documentContentIncluded, false, 'telemetry command must omit document content');

  const unknown = runReadOnlyCommand({ command: 'nova.lsp.writeFile', arguments: ['unsafe'] }, metadata) as { ok?: boolean; error?: string };
  assert.equal(unknown.ok, false, 'write-like commands should be denied');
  assert.match(unknown.error ?? '', /Unknown|non-read-only|Unsupported/i, 'write-like denial should be safe');

  assert.equal(deniedReason('.env'), '.env files are denied', '.env must be denied');
  assert.equal(deniedReason('node_modules/pkg/index.js'), 'node_modules is denied', 'node_modules must be denied');
  assert.match(deniedReason('.nova/evals/run/report.json') ?? '', /raw artifacts are denied/, 'raw .nova evals must be denied');
  assert.match(deniedReason('id_rsa.pem') ?? '', /private key/, 'private key extensions must be denied');

  assert.equal(resolvePolicyPath('../outside.txt').ok, false, 'path traversal must be refused');
  assert.equal(resolvePolicyPath('safe\0path.txt').ok, false, 'NUL byte paths must be refused');
  assert.equal(await readSafeTextFile('.env'), undefined, 'denied files must not be read');

  const redacted = redactText('OPENAI_API_KEY=sk-1234567890abcdef password=supersecret');
  assert(!redacted.includes('sk-1234567890abcdef'), 'API key value must be redacted');
  assert(!redacted.includes('supersecret'), 'password value must be redacted');
  assert.equal(containsPrivateKeyMaterial('-----BEGIN OPENSSH PRIVATE KEY-----'), true, 'private key material should be detected');

  const capped = capText('x'.repeat(1_500), 1_000);
  assert.equal(capped.truncated, true, 'capText should report truncation');
  assert(capped.text.includes('truncated'), 'truncated text should include metadata');

  const safe = safeError(new Error('token=secret-value\nstack should not leak'));
  assert(!safe.includes('secret-value'), 'safeError must redact secret-like values');
  assert(!safe.includes('stack should not leak'), 'safeError should remove multiline details');

  const doc: MinimalDocument = {
    uri: 'file:///package.json',
    getText: () => 'Mention .env and .nova/evals/raw/report.json plus api_key=secret.',
  };
  const diagnostics = computeDiagnostics(doc as never, metadata);
  const diagnosticText = JSON.stringify(diagnostics);
  assert(diagnosticText.includes('Sensitive .env paths'), '.env diagnostic missing');
  assert(diagnosticText.includes('Raw .nova traces/evals/reports are denied'), 'raw .nova diagnostic missing');
  assert(diagnosticText.includes('Secret-like content mention detected'), 'secret diagnostic missing');

  const packageDoc: MinimalDocument = {
    uri: 'file:///package.json',
    getText: () => JSON.stringify({ scripts: { 'lsp:stdio': 'tsx src/lsp/server.ts --stdio', 'lsp:policy-smoke': 'tsx src/lsp/policy_smoke.ts' } }, null, 2),
  };
  const packageDiagnostics = computeDiagnostics(packageDoc as never, metadata);
  const missingScript = packageDiagnostics.find((diagnostic) => String(diagnostic.message).includes('Missing expected Nova script: eval:lsp'));
  assert(missingScript, 'missing expected script diagnostic should be present');
  assert(missingScript?.range.start.line === 1, 'missing script diagnostic should target scripts object line');
  const lspScript = packageDiagnostics.find((diagnostic) => String(diagnostic.message).includes('Nova LSP script detected: lsp:policy-smoke'));
  assert(lspScript, 'LSP script detection diagnostic should be present');
  assert(lspScript?.range.start.line === 3, 'LSP script diagnostic should target the script key line');

  const lensDoc: MinimalDocument = {
    uri: 'file:///nova-lsp-codelens.md',
    getText: () => ['# CodeLens', 'nova_mcp_capabilities', 'nova://mcp/transport-readiness', 'lsp-v1-1-source-derived-metadata'].join('\n'),
  };
  const lenses = codeLensesFor(lensDoc as never, metadata);
  assert(lenses.length >= 3, 'read-only CodeLens should be produced for known metadata');
  assert(lenses.every((lens) => (lens.data as { readOnly?: boolean } | undefined)?.readOnly === true), 'CodeLens data should be marked read-only');
  assert(lenses.every((lens) => !/write|bash|shell/i.test(lens.command?.command ?? '')), 'CodeLens commands must not be write/shell');
  assert(lenses.some((lens) => lens.command?.command === 'nova.lsp.showToolMetadata'), 'CodeLens should use read-only tool metadata command');

  const item = findMetadataAtText('nova.lsp.showSetupGuide', metadata);
  assert.equal(item?.id, 'command:nova.lsp.showSetupGuide', 'metadata lookup should find setup command');
  assert(formatMetadataItem(item).includes('Read-only: yes'), 'formatted metadata should include read-only marker');
  const sourceItem = findMetadataAtText('nova://mcp/transport-readiness', metadata);
  assert.equal(sourceItem?.id, 'mcp-resource:nova://mcp/transport-readiness', 'metadata lookup should prefer source-derived MCP resource');

  console.log(JSON.stringify({ ok: true, commands: commands.length, metadataItems: metadata.items.length, diagnostics: diagnostics.length }, null, 2));
}

main().catch((err) => {
  console.error('lsp:policy-smoke failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
