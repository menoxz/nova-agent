#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PROJECT_ROOT_PLACEHOLDER } from './smoke_constants.js';

const projectRoot = PROJECT_ROOT_PLACEHOLDER;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function textFrom(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.map((item: unknown) => {
    if (typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'text') {
      return String((item as { text?: unknown }).text ?? '');
    }
    return '';
  }).join('\n');
}

function structuredFrom(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  return (typeof result.structuredContent === 'object' && result.structuredContent !== null) ? result.structuredContent as Record<string, unknown> : {};
}

async function readResourceText(client: Client, uri: string): Promise<string> {
  const result = await client.readResource({ uri });
  return result.contents.map((item) => 'text' in item ? item.text : '').join('\n');
}

async function main(): Promise<void> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'nova-mcp-smoke-'));
  await writeFile(join(fixtureRoot, 'literal.txt'), 'nova.*agent\nnovaXagent\n', 'utf-8');
  await writeFile(join(fixtureRoot, 'certificate-material.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-test-only\n-----END OPENSSH PRIVATE KEY-----\n', 'utf-8');
  await writeFile(join(fixtureRoot, 'config_sample.txt'), 'api_key=synthetic_token_value_12345\n', 'utf-8');
  const client = new Client({ name: 'nova-mcp-smoke-client', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['node_modules/tsx/dist/cli.mjs', 'src/mcp/server.ts'],
    cwd: projectRoot,
    env: { ...process.env, NOVA_MCP_ALLOWED_ROOTS: fixtureRoot },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const required of ['nova_tool_catalog', 'nova_mcp_capabilities', 'nova_read_file', 'nova_list_directory', 'nova_search_files', 'nova_search_text', 'nova_git_status', 'nova_git_diff', 'nova_git_log', 'nova_doc_read', 'nova_eval_list_scenarios', 'nova_eval_schema_info', 'nova_trace_summarize']) {
      assert(names.includes(required), `missing tool ${required}`);
    }
    assert(!names.includes('nova_bash'), 'nova_bash must not be registered by default');
    assert(!names.includes('nova_write_file'), 'nova_write_file must not be registered by default');

    const resources = await client.listResources();
    assert(resources.resources.some((resource) => resource.uri === 'nova://docs/mcp/readme'), 'missing MCP README resource');
    for (const required of ['nova://mcp/capabilities', 'nova://mcp/policy', 'nova://mcp/gated-tools-policy', 'nova://resources/schema-policy', 'nova://mcp/release-checklist', 'nova://mcp/compatibility', 'nova://tools/schemas', 'nova://docs/index', 'nova://eval/recent-summary', 'nova://eval/latest-summary', 'nova://reports/latest-summary', 'nova://trace/summary', 'nova://observability/summary']) {
      assert(resources.resources.some((resource) => resource.uri === required), `missing V1.1 resource ${required}`);
    }
    const prompts = await client.listPrompts();
    assert(prompts.prompts.some((prompt) => prompt.name === 'nova_repository_orientation'), 'missing repository orientation prompt');

    const catalog = await client.callTool({ name: 'nova_tool_catalog', arguments: {} });
    assert(textFrom(catalog).includes('nova_read_file'), 'tool catalog did not mention nova_read_file');
    assert(textFrom(catalog).includes('nova_mcp_capabilities'), 'tool catalog did not mention nova_mcp_capabilities');

    const capabilities = await client.callTool({ name: 'nova_mcp_capabilities', arguments: {} });
    assert(capabilities.isError !== true, 'capabilities tool should succeed');
    assert(textFrom(capabilities).includes('stdio'), 'capabilities should document stdio default');
    assert(textFrom(capabilities).includes('nova_bash'), 'capabilities should list disabled nova_bash');
    assert(!textFrom(capabilities).includes(projectRoot), 'capabilities must not disclose project root');
    assert(!textFrom(capabilities).includes(fixtureRoot), 'capabilities must not disclose fixture root');

    const capabilitiesResource = await readResourceText(client, 'nova://mcp/capabilities');
    assert(capabilitiesResource.includes('hardOutputMaxChars'), 'capabilities resource should expose output caps metadata');
    assert(capabilitiesResource.includes('nova://tools/schemas'), 'capabilities resource should list V1.1 resources');
    const policyResource = await readResourceText(client, 'nova://mcp/policy');
    assert(policyResource.includes('raw .nova/traces'), 'policy resource should document raw trace denial');
    assert(policyResource.includes('literal'), 'policy resource should document literal search default');
    const gatedToolsPolicy = await readResourceText(client, 'nova://mcp/gated-tools-policy');
    assert(gatedToolsPolicy.includes('"mutatingToolsRegisteredByDefault": false'), 'gated tools policy should keep mutating tools disabled');
    assert(gatedToolsPolicy.includes('"novaBashRegistered": false'), 'gated tools policy should keep nova_bash absent');
    assert(gatedToolsPolicy.includes('"novaWriteFileRegistered": false'), 'gated tools policy should keep nova_write_file absent');
    assert(gatedToolsPolicy.includes('NOVA_MCP_ENABLE_BASH=1'), 'gated tools policy should document bash env gate');
    assert(gatedToolsPolicy.includes('NOVA_MCP_ENABLE_WRITE_FILE=1'), 'gated tools policy should document write env gate');
    assert(gatedToolsPolicy.includes('NOVA_MCP_ENABLE_STATE_TOOLS=1'), 'gated tools policy should document state env gate');
    assert(gatedToolsPolicy.includes('"actionsImplementedInThisSlice": false'), 'gated tools policy should not implement actions');
    assert(!gatedToolsPolicy.includes(projectRoot), 'gated tools policy must not disclose project root');
    assert(!gatedToolsPolicy.includes(fixtureRoot), 'gated tools policy must not disclose fixture root');
    const schemaPolicyResource = await readResourceText(client, 'nova://resources/schema-policy');
    assert(schemaPolicyResource.includes('"resourceSchemaVersion": 1'), 'schema policy should expose resource schema version');
    assert(schemaPolicyResource.includes('"resourcePolicyVersion": 1'), 'schema policy should expose resource policy version');
    assert(schemaPolicyResource.includes('"uriStability"'), 'schema policy should document URI stability');
    assert(schemaPolicyResource.includes('"rawNovaArtifactsExposed": false'), 'schema policy should preserve raw artifact invariant');
    assert(schemaPolicyResource.includes('nova://observability/summary'), 'schema policy should inventory observability resource');
    assert(!schemaPolicyResource.includes(projectRoot), 'schema policy must not disclose project root');
    assert(!schemaPolicyResource.includes(fixtureRoot), 'schema policy must not disclose fixture root');
    const releaseChecklist = await readResourceText(client, 'nova://mcp/release-checklist');
    assert(releaseChecklist.includes('npm run release:readiness'), 'release checklist should include readiness command');
    assert(releaseChecklist.includes('"httpOrStreamableEnabled": false'), 'release checklist should keep HTTP/streamable disabled');
    assert(releaseChecklist.includes('No npm publish'), 'release checklist should state no publish action');
    assert(!releaseChecklist.includes(projectRoot), 'release checklist must not disclose project root');
    assert(!releaseChecklist.includes(fixtureRoot), 'release checklist must not disclose fixture root');
    const compatibility = await readResourceText(client, 'nova://mcp/compatibility');
    assert(compatibility.includes('Node.js 22'), 'compatibility resource should document Node baseline');
    assert(compatibility.includes('@modelcontextprotocol/sdk'), 'compatibility resource should document MCP SDK baseline');
    assert(compatibility.includes('stdio only by default'), 'compatibility resource should document stdio-only default');
    assert(!compatibility.includes(projectRoot), 'compatibility must not disclose project root');
    assert(!compatibility.includes(fixtureRoot), 'compatibility must not disclose fixture root');
    const schemasResource = await readResourceText(client, 'nova://tools/schemas');
    assert(schemasResource.includes('nova_read_file'), 'schemas resource should include read_file');
    assert(schemasResource.includes('registered'), 'schemas resource should include registration metadata');
    const docsIndex = await readResourceText(client, 'nova://docs/index');
    assert(docsIndex.includes('docs/mcp/BACKLOG_V1_1.md'), 'docs index should include MCP backlog');

    for (const uri of ['nova://eval/recent-summary', 'nova://eval/latest-summary', 'nova://reports/latest-summary', 'nova://trace/summary', 'nova://observability/summary']) {
      const observability = await readResourceText(client, uri);
      assert(observability.includes('"sanitized": true'), `${uri} should declare sanitized policy`);
      assert(observability.includes('"rawArtifactsExposed": false'), `${uri} should refuse raw artifacts`);
      assert(!observability.includes(projectRoot), `${uri} must not disclose project root`);
      assert(!observability.includes(fixtureRoot), `${uri} must not disclose fixture root`);
      assert(!observability.includes('report.json'), `${uri} must not expose raw report file paths`);
      assert(!observability.includes('.nova\\') && !observability.includes('.nova/'), `${uri} must not expose raw .nova paths`);
      assert(!observability.includes('synthetic_token_value_12345'), `${uri} must not expose synthetic secrets`);
    }

    const deniedEnv = await client.callTool({ name: 'nova_read_file', arguments: { path: '.env' } });
    assert(deniedEnv.isError === true, '.env read should be denied with isError');
    assert(textFrom(deniedEnv).includes('Access denied'), '.env denial should be safe/actionable');

    const deniedNova = await client.callTool({ name: 'nova_read_file', arguments: { path: '.nova/evals/example/report.json' } });
    assert(deniedNova.isError === true, '.nova/evals raw read should be denied');

    const traversal = await client.callTool({ name: 'nova_read_file', arguments: { path: '../package.json' } });
    assert(traversal.isError === true, '.. traversal should be denied');

    const outside = await client.callTool({ name: 'nova_read_file', arguments: { path: dirname(projectRoot) } });
    assert(outside.isError === true, 'absolute outside-root path should be denied');
    assert(!textFrom(outside).includes(projectRoot), 'outside-root denial must not expose configured root paths');
    assert(!textFrom(outside).includes(fixtureRoot), 'outside-root denial must not expose extra allowed root paths');

    const deniedGit = await client.callTool({ name: 'nova_read_file', arguments: { path: '.git/config' } });
    assert(deniedGit.isError === true, '.git read should be denied');

    const deniedNodeModules = await client.callTool({ name: 'nova_read_file', arguments: { path: 'node_modules/typescript/package.json' } });
    assert(deniedNodeModules.isError === true, 'node_modules read should be denied');

    const deniedKeyFilename = await client.callTool({ name: 'nova_read_file', arguments: { path: join(fixtureRoot, 'fake-private.pem') } });
    assert(deniedKeyFilename.isError === true, 'private-key filename should be denied before file access');

    const deniedKeyContent = await client.callTool({ name: 'nova_read_file', arguments: { path: join(fixtureRoot, 'certificate-material.txt') } });
    assert(deniedKeyContent.isError === true, 'private-key content should be refused');

    const redacted = await client.callTool({ name: 'nova_read_file', arguments: { path: join(fixtureRoot, 'config_sample.txt') } });
    assert(redacted.isError !== true, 'synthetic config fixture should be readable');
    assert(textFrom(redacted).includes('<redacted>'), 'secret-like synthetic content should be redacted');
    assert(!textFrom(redacted).includes('synthetic_token_value_12345'), 'secret-like synthetic content must not be exposed');

    const truncated = await client.callTool({ name: 'nova_read_file', arguments: { path: 'package.json', maxChars: 1000 } });
    assert(structuredFrom(truncated).truncated === true, 'truncated reads should expose truncation metadata');

    const literalSearch = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: 'nova.*agent', maxResults: 5 } });
    assert(literalSearch.isError !== true, 'literal search should succeed');
    assert(textFrom(literalSearch).includes('nova.*agent'), 'literal search should match literal metacharacters');
    assert(!textFrom(literalSearch).includes('novaXagent'), 'literal search must not treat pattern as regex by default');

    const regexSearch = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: 'nova.*agent', regex: true, maxResults: 5 } });
    assert(regexSearch.isError !== true, 'explicit regex search should succeed');
    assert(textFrom(regexSearch).includes('novaXagent'), 'explicit regex search should use regex semantics');

    const dangerousRegex = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: '^(a+)+$', regex: true } });
    assert(dangerousRegex.isError === true, 'dangerous nested-quantifier regex should be rejected');

    const longPattern = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: 'a'.repeat(301) } });
    assert(longPattern.isError === true, 'overlong search pattern should be rejected');

    const packageRead = await client.callTool({ name: 'nova_read_file', arguments: { path: 'package.json', limit: 5 } });
    assert(packageRead.isError !== true, 'package.json read should succeed');
    assert(textFrom(packageRead).includes('nova-agent'), 'package.json read should include project name');

    console.log(JSON.stringify({ ok: true, toolCount: tools.tools.length, resourceCount: resources.resources.length, promptCount: prompts.prompts.length }, null, 2));
  } finally {
    await client.close();
    await transport.close().catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
