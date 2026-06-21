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
    for (const required of ['nova_tool_catalog', 'nova_read_file', 'nova_list_directory', 'nova_search_files', 'nova_search_text', 'nova_git_status', 'nova_git_diff', 'nova_git_log', 'nova_doc_read', 'nova_eval_list_scenarios', 'nova_eval_schema_info', 'nova_trace_summarize']) {
      assert(names.includes(required), `missing tool ${required}`);
    }
    assert(!names.includes('nova_bash'), 'nova_bash must not be registered by default');
    assert(!names.includes('nova_write_file'), 'nova_write_file must not be registered by default');

    const resources = await client.listResources();
    assert(resources.resources.some((resource) => resource.uri === 'nova://docs/mcp/readme'), 'missing MCP README resource');
    const prompts = await client.listPrompts();
    assert(prompts.prompts.some((prompt) => prompt.name === 'nova_repository_orientation'), 'missing repository orientation prompt');

    const catalog = await client.callTool({ name: 'nova_tool_catalog', arguments: {} });
    assert(textFrom(catalog).includes('nova_read_file'), 'tool catalog did not mention nova_read_file');

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
