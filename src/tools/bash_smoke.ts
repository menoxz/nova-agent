#!/usr/bin/env node
/** Offline smoke for the mutating bash tool's ExecutionSandbox routing. */
import assert from 'node:assert/strict';

import { bashTool } from './builtin/bash.js';

async function run(input: Record<string, unknown>): Promise<string> {
  const out = await bashTool.execute(input);
  if (typeof out === 'string') return out;
  if (out.type === 'execution-denied') return `[execution-denied]${out.reason ? ` ${out.reason}` : ''}`;
  const value: unknown = out.value;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function has(haystack: string, needle: string, label: string): void {
  assert.ok(
    haystack.includes(needle),
    `${label}: expected output to contain ${JSON.stringify(needle)}\n--- actual ---\n${haystack}\n--------------`,
  );
}

function lacks(haystack: string, needle: RegExp, label: string): void {
  assert.doesNotMatch(haystack, needle, `${label}: output leaked ${needle}`);
}

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prior = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) prior.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  await withEnv({ NOVA_ENABLE_EXEC_SANDBOX: undefined }, async () => {
    const legacy = await run({ command: 'node -e "console.log(\'legacy-ok\')"', timeout: 10_000, workdir: process.cwd() });
    has(legacy, 'Mode: legacy-shell', 'legacy default mode');
    has(legacy, 'legacy-ok', 'legacy command output');
  });

  await withEnv({ NOVA_ENABLE_EXEC_SANDBOX: '1' }, async () => {
    const sandboxed = await run({
      command: 'node -e "console.log((process.env.BASH_SANDBOX_SMOKE || \'missing\') + \':\' + (process.env.LLM_API_KEY || \'secret-missing\'))"',
      timeout: 10_000,
      workdir: process.cwd(),
      env: { BASH_SANDBOX_SMOKE: 'sandbox-ok', LLM_API_KEY: 'synthetic-secret-must-not-appear' },
    });
    has(sandboxed, 'Mode: execution-sandbox', 'sandbox opt-in mode');
    has(sandboxed, 'execution-sandbox/hardened-subprocess@1', 'sandbox implementation marker');
    has(sandboxed, 'sandbox-ok:secret-missing', 'sandbox env allow-list addition without sensitive env forwarding');
    lacks(sandboxed, /synthetic-secret-must-not-appear/, 'sandbox does not leak caller secrets');

    const protectedPath = await run({
      command: 'node -e "console.log(process.env.PATH === \'OVERRIDE\' ? \'bad\' : \'path-protected\')"',
      timeout: 10_000,
      workdir: process.cwd(),
      env: { PATH: 'OVERRIDE' },
    });
    has(protectedPath, 'path-protected', 'sandbox PATH override is dropped');
    lacks(protectedPath, /\bbad\b/, 'sandbox protected env cannot be overridden');

    const stdin = await run({ command: 'node -e "console.log(\'should-not-run\')"', timeout: 10_000, workdir: process.cwd(), stdin: 'blocked' });
    has(stdin, 'Refused to run via ExecutionSandbox: stdin is not supported', 'sandbox stdin fail-closed');
    lacks(stdin, /should-not-run/, 'sandbox stdin refusal does not execute command');
  });

  console.log('bash:smoke passed');
}

main().catch((err) => {
  console.error('bash:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
