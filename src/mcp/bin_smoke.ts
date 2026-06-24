#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function run(command: string, args: string[], cwd = process.cwd(), shell = false) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
    shell,
  });
}

async function assertMcpHandshake(command: string, args: string[], label: string): Promise<void> {
  const client = new Client({ name: `nova-mcp-bin-smoke-${label}`, version: '0.1.0' });
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: process.cwd(),
    env: { ...process.env, LLM_API_KEY: '' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert(names.includes('nova_mcp_capabilities'), `${label} exposes nova_mcp_capabilities`);
    assert(!names.includes('nova_bash'), `${label} must not expose nova_bash`);
    assert(!names.includes('nova_write_file'), `${label} must not expose nova_write_file`);
    const resources = await client.listResources();
    assert(resources.resources.some((resource) => resource.uri === 'nova://mcp/capabilities'), `${label} exposes capabilities resource`);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

  const directHelp = run(process.execPath, ['bin/nova-mcp.js', '--help']);
  assert.equal(directHelp.status, 0, `direct nova-mcp help exits 0: ${directHelp.stderr}`);
  assert.match(directHelp.stdout ?? '', /Nova Agent MCP Server/, 'direct nova-mcp renders help');
  assert.match(directHelp.stdout ?? '', /stdio only/i, 'direct nova-mcp documents stdio-only posture');
  assert.doesNotMatch((directHelp.stderr ?? '') + (directHelp.stdout ?? ''), /LLM_API_KEY not set/, 'direct nova-mcp help does not require LLM key');
  const directVersion = run(process.execPath, ['bin/nova-mcp.js', '--version']);
  assert.equal(directVersion.status, 0, `direct nova-mcp version exits 0: ${directVersion.stderr}`);
  assert.equal((directVersion.stdout ?? '').trim(), `@lux-tech/nova-agent-mcp ${packageJson.version}`, 'direct nova-mcp prints package version');

  const unsupported = run(process.execPath, ['bin/nova-mcp.js', '--bad-flag']);
  assert.equal(unsupported.status, 2, 'direct nova-mcp rejects unsupported args instead of passing them to server');

  const build = run('npm', ['run', 'build'], process.cwd(), process.platform === 'win32');
  assert.equal(build.status, 0, `npm run build exits 0: ${build.stderr}`);
  await assertMcpHandshake(process.execPath, ['bin/nova-mcp.js'], 'built-bin');

  const root = await mkdtemp(join(tmpdir(), 'nova-mcp-bin-smoke-'));
  try {
    const link = run('npm', ['link', process.cwd()], root, process.platform === 'win32');
    assert.equal(link.status, 0, `npm link install exits 0: ${link.stderr}`);
    const linkedHelp = run('nova-mcp', ['--help'], root, process.platform === 'win32');
    assert.equal(linkedHelp.status, 0, `linked nova-mcp --help exits 0: ${linkedHelp.stderr}`);
    assert.match(linkedHelp.stdout ?? '', /Nova Agent MCP Server/, 'linked nova-mcp renders help');
    const linkedVersion = run('nova-mcp', ['--version'], root, process.platform === 'win32');
    assert.equal(linkedVersion.status, 0, `linked nova-mcp --version exits 0: ${linkedVersion.stderr}`);
    assert.equal((linkedVersion.stdout ?? '').trim(), `@lux-tech/nova-agent-mcp ${packageJson.version}`, 'linked nova-mcp prints package version');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log('mcp:bin-smoke passed');
}

main().catch((err) => {
  console.error('mcp:bin-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
