#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtEntry = join(root, 'dist', 'mcp', 'server.js');
const sourceEntry = join(root, 'src', 'mcp', 'server.ts');

if (['--version', '-v', 'version'].includes(process.argv[2] ?? '')) {
  try {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    console.log(`${packageJson.name ?? 'nova-agent'}-mcp ${packageJson.version ?? '0.0.0-unknown'}`);
  } catch {
    console.log('nova-agent-mcp 0.0.0-unknown');
  }
  process.exit(0);
}

if (['--help', '-h', 'help'].includes(process.argv[2] ?? '')) {
  console.log(`Nova Agent MCP Server

Usage:
  nova-mcp              Start the Nova MCP server over stdio
  nova-mcp --version    Print package version

Transport: stdio only. HTTP/streamable transport and mutating/state tools are not enabled by this entrypoint.`);
  process.exit(0);
}

if (process.argv.length > 2) {
  console.error('nova-mcp: unsupported arguments. Use --help for usage.');
  process.exit(2);
}

if (existsSync(builtEntry)) {
  const mod = await import(pathToFileURL(builtEntry).href);
  if (typeof mod.startNovaMcpStdioServer !== 'function') {
    console.error('nova-mcp: built MCP entrypoint is missing startNovaMcpStdioServer');
    process.exit(1);
  }
  await mod.startNovaMcpStdioServer();
} else {
  const result = spawnSync(process.execPath, ['--import', 'tsx', sourceEntry], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (typeof result.status === 'number') process.exit(result.status);
  if (result.signal) {
    console.error(`nova-mcp: fallback tsx process terminated by ${result.signal}`);
    process.exit(1);
  }
  process.exit(0);
}
