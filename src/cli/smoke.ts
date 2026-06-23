#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type CliResult = { status: number | null; stdout: string; stderr: string };

function runNova(args: string[]): CliResult {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function assertOkHelp(args: string[], expected: string[]): void {
  const result = runNova(args);
  assert.equal(result.status, 0, `${args.join(' ')} should exit 0: ${result.stderr}`);
  for (const text of expected) assert.match(result.stdout, new RegExp(text), `${args.join(' ')} should include ${text}`);
  assert.doesNotMatch(result.stderr + result.stdout, /LLM_API_KEY not set/, `${args.join(' ')} must not require LLM_API_KEY`);
}

function assertOkVersion(args: string[], expectedVersion: string): void {
  const result = runNova(args);
  assert.equal(result.status, 0, `${args.join(' ')} should exit 0: ${result.stderr}`);
  assert.equal(result.stdout.trim(), `@lux-tech/nova-agent ${expectedVersion}`, `${args.join(' ')} should print package version`);
  assert.doesNotMatch(result.stderr + result.stdout, /LLM_API_KEY not set/, `${args.join(' ')} must not require LLM_API_KEY`);
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
  assertOkHelp(['--help'], ['Nova Agent', `v${packageJson.version}`, 'Main flags', '--version', '--profile', '--stream-mode']);
  assertOkVersion(['--version'], packageJson.version);
  assertOkVersion(['-v'], packageJson.version);
  assertOkVersion(['version'], packageJson.version);
  assertOkHelp(['help'], ['Topics', 'streaming', 'conversations']);
  assertOkHelp(['streaming', '--help'], ['streaming', 'streaming replay <logId>', '--thinking']);
  assertOkHelp(['providers', '--help'], ['providers list', 'providers doctor', 'Fallback is opt-in']);
  assertOkHelp(['config', '--help'], ['config show', 'Precedence', 'never secrets']);
  assertOkHelp(['sessions', '--help'], ['sessions list', 'sessions current']);
  assertOkHelp(['runs', '--help'], ['runs replay', 'resume-current']);
  assertOkHelp(['approvals', '--help'], ['approvals list', 'approve <approvalId>']);
  assertOkHelp(['conversations', '--help'], ['conversations show', 'without LLM']);
  assertOkHelp(['eval', '--help'], ['eval reports', 'eval list', 'eval compare', 'report.json']);

  const unknown = runNova(['stremaing']);
  assert.equal(unknown.status, 1, 'unknown command exits 1');
  assert.match(unknown.stderr, /Unknown Nova command: stremaing/, 'unknown command explained');
  assert.match(unknown.stderr, /Did you mean: nova streaming --help/, 'near command suggestion shown');
  assert.doesNotMatch(unknown.stderr + unknown.stdout, /LLM_API_KEY not set/, 'unknown command does not reach LLM key check');

  const missing = runNova(['streaming', 'show']);
  assert.equal(missing.status, 1, 'missing argument exits 1');
  assert.match(missing.stderr, /Missing argument\. Usage: nova streaming show <logId>/, 'missing argument usage shown');
  assert.doesNotMatch(missing.stderr + missing.stdout, /LLM_API_KEY not set/, 'missing argument does not reach LLM key check');

  const providerDoctor = runNova(['providers', 'doctor']);
  assert.equal(providerDoctor.status, 0, 'providers doctor exits 0 without LLM key');
  assert.match(providerDoctor.stdout, /"status": "missing"/, 'providers doctor reports missing key without value');
  assert.doesNotMatch(providerDoctor.stderr + providerDoctor.stdout, /LLM_API_KEY not set/, 'providers doctor does not reach LLM key check');

  console.log('cli:smoke passed');
}

main().catch((err) => {
  console.error('cli:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
