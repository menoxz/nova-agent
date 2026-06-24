#!/usr/bin/env node
import assert from 'node:assert/strict';

import { computeDiagnostics } from './diagnostics.js';
import { buildMetadataIndex, findMetadataAtText, formatMetadataItem, LSP_COMMANDS } from './metadata.js';
import { capText, containsPrivateKeyMaterial, deniedReason, readSafeTextFile, redactText, resolvePolicyPath, safeError } from './policy.js';
import { createCapabilities } from './capabilities.js';
import { runReadOnlyCommand } from './commands.js';

type MinimalDocument = {
  uri: string;
  getText(): string;
};

async function main(): Promise<void> {
  const metadata = await buildMetadataIndex();
  assert(metadata.items.length > 0, 'metadata index should not be empty');
  assert(metadata.byId.has('command:nova.lsp.showSetupGuide'), 'setup command metadata missing');
  assert(metadata.byId.has('policy:lsp-v1-1-client-setup'), 'client setup policy metadata missing');
  for (const command of LSP_COMMANDS) {
    assert(metadata.byId.has(`command:${command}`), `command metadata missing for ${command}`);
  }

  const capabilities = createCapabilities();
  assert(!('workspaceEdit' in capabilities), 'WorkspaceEdit must not be advertised');
  assert(!('codeActionProvider' in capabilities), 'code actions must not be advertised');
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

  const item = findMetadataAtText('nova.lsp.showSetupGuide', metadata);
  assert.equal(item?.id, 'command:nova.lsp.showSetupGuide', 'metadata lookup should find setup command');
  assert(formatMetadataItem(item).includes('Read-only: yes'), 'formatted metadata should include read-only marker');

  console.log(JSON.stringify({ ok: true, commands: commands.length, metadataItems: metadata.items.length, diagnostics: diagnostics.length }, null, 2));
}

main().catch((err) => {
  console.error('lsp:policy-smoke failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
