/**
 * Isolated smoke test for the hardened-subprocess ExecutionSandbox (ADR-002
 * Slice 3). Run via `npm run sandbox:smoke` (and inside `npm run check`).
 *
 * This file is the ONLY place under the sandbox tree that is allowed to spawn
 * real child processes during CI: it proves the security-relevant behaviour of
 * {@link ../sandbox/sandbox.ts} end-to-end, offline and deterministically.
 *
 * It deliberately lives in `src/sandbox/`, NOT `src/heartbeat/`, so it never
 * trips the heartbeat static guard. It uses `node:` builtins only and spawns
 * `process.execPath` (the Node binary already running this test) so it needs no
 * external tools and works identically on Windows/Linux/macOS.
 *
 * Coverage:
 *   1. base env allow-list   — parent secrets never reach the child (e2e spawn)
 *   2. caller deny-list      — loader-injection vars dropped; no proto pollution
 *   3. PATH cannot be overridden by the caller; invalid names dropped
 *   4. wall-clock timeout     — exitCode forced null
 *   5. combined-output truncation — exitCode forced null
 *   6. cwd jail               — in-root accepted, out-of-root rejected
 *   7. shell-free arg passing — metacharacters never interpreted
 *   8. clampNumber budgets    — floor + [min,max] clamping
 *   9. probe opt-in (SB1)     — strict "1"/"true", else null
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../policy/path.js';
import { buildChildEnv, clampNumber, createExecutionSandbox } from './sandbox.js';
import { probeExecutionSandbox } from './probe.js';
import {
  SANDBOX_DEFAULT_MAX_OUTPUT_CHARS,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MAX_OUTPUT_CHARS,
  SANDBOX_MAX_TIMEOUT_MS,
} from './types.js';

const NODE = process.execPath;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** 1 — Parent-process secrets must never leak into the child environment. */
async function testEnvAllowList(): Promise<void> {
  const sentinelKey = 'NOVA_SECRET_SENTINEL';
  const had = Object.prototype.hasOwnProperty.call(process.env, sentinelKey);
  const previous = process.env[sentinelKey];
  process.env[sentinelKey] = 'super-secret-value';
  try {
    const sandbox = createExecutionSandbox();
    const result = await sandbox.run({
      command: NODE,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({sentinel:process.env.NOVA_SECRET_SENTINEL??null,path:!!process.env.PATH}))',
      ],
    });
    const parsed = JSON.parse(result.stdout) as { sentinel: string | null; path: boolean };
    assert(parsed.sentinel === null, 'parent secret leaked into sandbox child env');
    assert(parsed.path === true, 'allow-listed PATH should be present in child env');
    assert(result.exitCode === 0, `expected clean exit, got ${String(result.exitCode)}`);
  } finally {
    if (had) process.env[sentinelKey] = previous;
    else delete process.env[sentinelKey];
  }
}

/** 2 — Caller-supplied loader-injection vars are dropped; no proto pollution. */
function testCallerDenyList(): void {
  const env = buildChildEnv({
    LD_PRELOAD: '/tmp/evil.so',
    LD_LIBRARY_PATH: '/tmp',
    NODE_OPTIONS: '--require /tmp/evil.js',
    DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
    SAFE_VAR: 'kept',
  });
  assert(env.LD_PRELOAD === undefined, 'LD_PRELOAD must be dropped');
  assert(env.LD_LIBRARY_PATH === undefined, 'LD_LIBRARY_PATH must be dropped');
  assert(env.NODE_OPTIONS === undefined, 'NODE_OPTIONS must be dropped');
  assert(env.DYLD_INSERT_LIBRARIES === undefined, 'DYLD_* loader vars must be dropped');
  assert(env.SAFE_VAR === 'kept', 'a benign caller var should survive');

  // __proto__ supplied as a caller key (e.g. from JSON) must not pollute the
  // prototype chain; the null-proto child env makes it an inert own property.
  const polluted = JSON.parse('{"__proto__":"polluted","OK_VAR":"ok"}') as Record<string, string>;
  const env2 = buildChildEnv(polluted);
  assert(Object.getPrototypeOf(env2) === null, 'child env must keep a null prototype');
  assert(({} as Record<string, unknown>).polluted === undefined, 'Object.prototype must not be polluted');
  assert(env2.OK_VAR === 'ok', 'sibling key must survive a __proto__ entry');
}

/** 3 — The caller can add vars but can never override the base PATH (SB2). */
function testPathNotOverridable(): void {
  const env = buildChildEnv({
    PATH: '/attacker/controlled/bin',
    NEW_ONE: 'added',
    'bad name': 'has-space',
    '1bad': 'starts-with-digit',
    GOOD_1: 'g',
  });
  assert(env.PATH === process.env.PATH, 'caller must not override the base PATH');
  assert(env.NEW_ONE === 'added', 'a valid new caller var should be added');
  assert(env['bad name'] === undefined, 'env name with a space must be dropped');
  assert(env['1bad'] === undefined, 'env name starting with a digit must be dropped');
  assert(env.GOOD_1 === 'g', 'a syntactically valid env name should survive');
}

/** 4 — A command exceeding its wall-clock budget times out with exitCode null. */
async function testTimeout(): Promise<void> {
  const sandbox = createExecutionSandbox();
  const result = await sandbox.run({
    command: NODE,
    args: ['-e', 'setTimeout(() => {}, 60000)'],
    timeoutMs: 250,
  });
  assert(result.timedOut === true, 'expected the command to time out');
  assert(result.exitCode === null, 'exitCode must be null when timed out');
}

/** 5 — Output beyond the cap is truncated and the run is marked timed-out/null. */
async function testTruncation(): Promise<void> {
  const sandbox = createExecutionSandbox();
  const result = await sandbox.run({
    command: NODE,
    args: ['-e', "process.stdout.write('x'.repeat(100000))"],
    maxOutputChars: 16,
  });
  assert(result.truncated === true, 'expected output to be truncated');
  assert(result.stdout.length === 16, `expected exactly 16 captured chars, got ${result.stdout.length}`);
  assert(result.exitCode === null, 'exitCode must be null when truncated');
}

/** 6 — cwd inside the project root is accepted; outside it is rejected. */
async function testCwdJail(): Promise<void> {
  const sandbox = createExecutionSandbox();

  const dir = mkdtempSync(join(PROJECT_ROOT, 'nova-sandbox-smoke-cwd-'));
  try {
    const result = await sandbox.run({
      command: NODE,
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: dir,
    });
    assert(
      realpathSync(result.stdout) === realpathSync(dir),
      `child cwd mismatch: ${result.stdout} vs ${dir}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let rejected = false;
  try {
    await sandbox.run({
      command: NODE,
      args: ['-e', 'process.stdout.write("should-not-run")'],
      cwd: tmpdir(),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'a cwd outside PROJECT_ROOT must be rejected');
}

/** 7 — Args are passed literally (shell:false); metacharacters are inert. */
async function testShellFree(): Promise<void> {
  const sandbox = createExecutionSandbox();
  const result = await sandbox.run({
    command: NODE,
    args: ['-e', 'process.stdout.write(process.argv.slice(1).join("|"))', 'alpha', 'be ta', '$NOVA'],
  });
  assert(result.stdout === 'alpha|be ta|$NOVA', `shell-free arg mismatch: ${JSON.stringify(result.stdout)}`);
}

/** 8 — Numeric budgets floor and clamp into [min,max] with a fallback. */
function testClamp(): void {
  assert(
    clampNumber(undefined, SANDBOX_DEFAULT_TIMEOUT_MS, 1, SANDBOX_MAX_TIMEOUT_MS) === SANDBOX_DEFAULT_TIMEOUT_MS,
    'undefined must fall back to the default',
  );
  assert(
    clampNumber(999_999_999, SANDBOX_DEFAULT_TIMEOUT_MS, 1, SANDBOX_MAX_TIMEOUT_MS) === SANDBOX_MAX_TIMEOUT_MS,
    'an over-large value must clamp to max',
  );
  assert(clampNumber(-5, SANDBOX_DEFAULT_TIMEOUT_MS, 1, SANDBOX_MAX_TIMEOUT_MS) === 1, 'a negative value must clamp to min');
  assert(
    clampNumber(Number.NaN, SANDBOX_DEFAULT_MAX_OUTPUT_CHARS, 1, SANDBOX_MAX_OUTPUT_CHARS) ===
      SANDBOX_DEFAULT_MAX_OUTPUT_CHARS,
    'NaN must fall back to the default',
  );
  assert(clampNumber(1234.9, SANDBOX_DEFAULT_TIMEOUT_MS, 1, SANDBOX_MAX_TIMEOUT_MS) === 1234, 'a float must be floored');
}

/** 9 — The probe is strict opt-in: only "1"/"true" yield a live sandbox (SB1). */
function testProbeOptIn(): void {
  const baseEnv: NodeJS.ProcessEnv = { ...process.env };
  delete baseEnv.NOVA_ENABLE_EXEC_SANDBOX;

  const cases: Array<{ value: string | undefined; available: boolean }> = [
    { value: undefined, available: false },
    { value: '0', available: false },
    { value: 'TRUE', available: false }, // case-sensitive: only lowercase "true"
    { value: ' 1 ', available: false }, // not trimmed
    { value: '1', available: true },
    { value: 'true', available: true },
  ];

  for (const { value, available } of cases) {
    const env: NodeJS.ProcessEnv =
      value === undefined ? baseEnv : { ...baseEnv, NOVA_ENABLE_EXEC_SANDBOX: value };
    const probed = probeExecutionSandbox(env);
    if (available) {
      assert(probed !== null && probed.available === true, `expected a live sandbox for ${JSON.stringify(value)}`);
    } else {
      assert(probed === null, `expected null (Gate C closed) for ${JSON.stringify(value)}`);
    }
  }
}

async function main(): Promise<void> {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ['env-allow-list', testEnvAllowList],
    ['caller-deny-list', testCallerDenyList],
    ['path-not-overridable', testPathNotOverridable],
    ['timeout', testTimeout],
    ['truncation', testTruncation],
    ['cwd-jail', testCwdJail],
    ['shell-free', testShellFree],
    ['clamp', testClamp],
    ['probe-opt-in', testProbeOptIn],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failed > 0) {
    console.error(`sandbox:smoke FAILED (${failed}/${tests.length})`);
    process.exit(1);
  }
  console.log('sandbox:smoke passed');
}

await main();
