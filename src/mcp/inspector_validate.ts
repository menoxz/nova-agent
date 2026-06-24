#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PROJECT_ROOT_PLACEHOLDER } from './smoke_constants.js';

const projectRoot = PROJECT_ROOT_PLACEHOLDER;

type CheckMetadata = Record<string, boolean | number | string | string[]>;
type CheckResult = { name: string; ok: boolean; metadata?: CheckMetadata; error?: string };

const REQUIRED_TOOLS = [
  'nova_tool_catalog',
  'nova_mcp_capabilities',
  'nova_read_file',
  'nova_list_directory',
  'nova_search_files',
  'nova_search_text',
  'nova_git_status',
  'nova_git_diff',
  'nova_git_log',
  'nova_doc_read',
  'nova_eval_list_scenarios',
  'nova_eval_schema_info',
  'nova_trace_summarize',
] as const;

const FORBIDDEN_TOOLS = ['nova_bash', 'nova_write_file', 'nova_todo_create', 'nova_goal_create', 'nova_skill_create'] as const;
const REQUIRED_RESOURCES = ['nova://docs/mcp/readme', 'nova://mcp/capabilities', 'nova://mcp/policy', 'nova://tools/schemas', 'nova://docs/index', 'nova://eval/recent-summary', 'nova://eval/latest-summary', 'nova://reports/latest-summary', 'nova://trace/summary', 'nova://observability/summary'] as const;
const REQUIRED_PROMPTS = ['nova_repository_orientation', 'nova_readonly_review', 'nova_tool_safety_review', 'nova_mcp_client_setup'] as const;

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

function sanitizeError(err: unknown, fixtureRoot: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replaceAll(projectRoot, '<project-root>')
    .replaceAll(fixtureRoot, '<fixture-root>')
    .replace(/synthetic_token_value_12345/g, '<redacted>')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '<private-key-redacted>');
}

async function runCheck(name: string, fixtureRoot: string, fn: () => Promise<CheckMetadata | void>): Promise<CheckResult> {
  try {
    const metadata = await fn();
    return metadata ? { name, ok: true, metadata } : { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: sanitizeError(err, fixtureRoot) };
  }
}

function noRootLeak(text: string, fixtureRoot: string): boolean {
  return !text.includes(projectRoot) && !text.includes(fixtureRoot);
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'nova-mcp-inspector-'));
  await writeFile(join(fixtureRoot, 'literal.txt'), 'nova.*agent\nnovaXagent\n', 'utf-8');
  await writeFile(join(fixtureRoot, 'certificate-material.txt'), '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-test-only\n-----END OPENSSH PRIVATE KEY-----\n', 'utf-8');
  await writeFile(join(fixtureRoot, 'config_sample.txt'), 'api_key=synthetic_token_value_12345\n', 'utf-8');

  const client = new Client({ name: 'nova-mcp-inspector-validator', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['node_modules/tsx/dist/cli.mjs', 'src/mcp/server.ts'],
    cwd: projectRoot,
    env: { ...process.env, NOVA_MCP_ALLOWED_ROOTS: fixtureRoot },
    stderr: 'pipe',
  });

  const checks: CheckResult[] = [];
  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    const resources = await client.listResources();
    const resourceUris = resources.resources.map((resource) => resource.uri);
    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((prompt) => prompt.name);

    checks.push(await runCheck('list-tools-resources-prompts', fixtureRoot, async () => {
      for (const name of REQUIRED_TOOLS) assert(toolNames.includes(name), `missing required tool ${name}`);
      for (const name of FORBIDDEN_TOOLS) assert(!toolNames.includes(name), `forbidden tool registered ${name}`);
      for (const uri of REQUIRED_RESOURCES) assert(resourceUris.includes(uri), `missing required resource ${uri}`);
      for (const name of REQUIRED_PROMPTS) assert(promptNames.includes(name), `missing required prompt ${name}`);
      return { toolCount: tools.tools.length, resourceCount: resources.resources.length, promptCount: prompts.prompts.length };
    }));

    checks.push(await runCheck('capabilities-tool-metadata', fixtureRoot, async () => {
      const result = await client.callTool({ name: 'nova_mcp_capabilities', arguments: {} });
      const text = textFrom(result);
      assert(result.isError !== true, 'capabilities call failed');
      assert(text.includes('stdio'), 'stdio default missing');
      assert(text.includes('nova_bash') && text.includes('nova_write_file'), 'disabled tool family metadata missing');
      assert(noRootLeak(text, fixtureRoot), 'capabilities leaked configured root path');
      return { textLength: text.length, rootPathsDisclosed: false };
    }));

    checks.push(await runCheck('curated-resource-reads', fixtureRoot, async () => {
      const capabilities = await readResourceText(client, 'nova://mcp/capabilities');
      const policy = await readResourceText(client, 'nova://mcp/policy');
      const schemas = await readResourceText(client, 'nova://tools/schemas');
      const docsIndex = await readResourceText(client, 'nova://docs/index');
      assert(capabilities.includes('hardOutputMaxChars'), 'capabilities resource missing limits');
      assert(policy.includes('raw .nova/traces') && policy.includes('literal'), 'policy resource missing deny/search metadata');
      assert(schemas.includes('nova_read_file') && schemas.includes('registered'), 'schemas resource missing tool metadata');
      assert(docsIndex.includes('docs/mcp/BACKLOG_V1_1.md'), 'docs index missing MCP backlog');
      assert(noRootLeak(`${capabilities}\n${policy}\n${schemas}\n${docsIndex}`, fixtureRoot), 'resource text leaked configured root path');
      return { resourcesRead: 4, rootPathsDisclosed: false };
    }));

    checks.push(await runCheck('sanitized-observability-resources', fixtureRoot, async () => {
      const uris = ['nova://eval/recent-summary', 'nova://eval/latest-summary', 'nova://reports/latest-summary', 'nova://trace/summary', 'nova://observability/summary'];
      for (const uri of uris) {
        const text = await readResourceText(client, uri);
        assert(text.includes('"sanitized": true'), `${uri} missing sanitized policy`);
        assert(text.includes('"rawArtifactsExposed": false'), `${uri} missing raw artifact refusal`);
        assert(noRootLeak(text, fixtureRoot), `${uri} leaked configured root path`);
        assert(!text.includes('report.json'), `${uri} exposed raw report path`);
        assert(!text.includes('.nova\\') && !text.includes('.nova/'), `${uri} exposed raw .nova path`);
        assert(!text.includes('synthetic_token_value_12345'), `${uri} exposed synthetic secret`);
      }
      return { resourcesRead: uris.length, rootPathsDisclosed: false, rawArtifactsExposed: false };
    }));

    checks.push(await runCheck('prompt-read', fixtureRoot, async () => {
      const result = await client.getPrompt({ name: 'nova_readonly_review', arguments: { target: 'src/mcp' } });
      const text = result.messages.map((message) => message.content.type === 'text' ? message.content.text : '').join('\n');
      assert(result.messages.length > 0, 'prompt returned no messages');
      assert(text.includes('read-only'), 'prompt does not preserve read-only guidance');
      return { messageCount: result.messages.length, textLength: text.length };
    }));

    checks.push(await runCheck('safe-read-and-redaction', fixtureRoot, async () => {
      const packageRead = await client.callTool({ name: 'nova_read_file', arguments: { path: 'package.json', limit: 5 } });
      assert(packageRead.isError !== true, 'safe package read failed');
      assert(structuredFrom(packageRead).ok === true, 'safe package read missing ok metadata');
      const redacted = await client.callTool({ name: 'nova_read_file', arguments: { path: join(fixtureRoot, 'config_sample.txt') } });
      const redactedText = textFrom(redacted);
      assert(redacted.isError !== true, 'synthetic redaction fixture failed');
      assert(redactedText.includes('<redacted>'), 'synthetic secret was not redacted');
      assert(!redactedText.includes('synthetic_token_value_12345'), 'synthetic secret leaked');
      return { safeReadOk: true, syntheticSecretRedacted: true };
    }));

    checks.push(await runCheck('representative-denials', fixtureRoot, async () => {
      const deniedCalls = [
        ['env', { path: '.env' }],
        ['raw-nova', { path: '.nova/evals/example/report.json' }],
        ['traversal', { path: '../package.json' }],
        ['outside-root', { path: dirname(projectRoot) }],
        ['git-internals', { path: '.git/config' }],
        ['node-modules', { path: 'node_modules/typescript/package.json' }],
        ['private-key-content', { path: join(fixtureRoot, 'certificate-material.txt') }],
      ] as const;
      for (const [, args] of deniedCalls) {
        const result = await client.callTool({ name: 'nova_read_file', arguments: args });
        assert(result.isError === true, 'denied read unexpectedly succeeded');
        assert(noRootLeak(textFrom(result), fixtureRoot), 'denied read leaked configured root path');
      }
      return { deniedCallCount: deniedCalls.length, rootPathsDisclosed: false };
    }));

    checks.push(await runCheck('search-semantics-and-guards', fixtureRoot, async () => {
      const literal = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: 'nova.*agent', maxResults: 5 } });
      const literalText = textFrom(literal);
      assert(literal.isError !== true, 'literal search failed');
      assert(literalText.includes('nova.*agent'), 'literal search did not match literal metacharacters');
      assert(!literalText.includes('novaXagent'), 'literal search behaved like regex');
      const regex = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: 'nova.*agent', regex: true, maxResults: 5 } });
      assert(regex.isError !== true, 'regex search failed');
      assert(textFrom(regex).includes('novaXagent'), 'regex opt-in did not use regex semantics');
      const dangerousRegex = await client.callTool({ name: 'nova_search_text', arguments: { root: fixtureRoot, pattern: '^(a+)+$', regex: true } });
      assert(dangerousRegex.isError === true, 'dangerous regex was not rejected');
      return { literalDefault: true, regexOptIn: true, dangerousRegexRejected: true };
    }));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  const failed = checks.filter((check) => !check.ok);
  const summary = {
    ok: failed.length === 0,
    validator: 'nova-mcp-inspector-stdio',
    transport: 'stdio',
    networkExposure: 'none',
    generatedArtifacts: 'none',
    startedAt,
    completedAt: new Date().toISOString(),
    checksPassed: checks.length - failed.length,
    checksFailed: failed.length,
    checks,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
