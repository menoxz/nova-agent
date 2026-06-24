/**
 * Hardened-subprocess ExecutionSandbox (ADR-002 Slice 3, Open-Q1).
 *
 * This is the *real* Gate C capability: a bounded, isolation-hardened way to run
 * a single `command`/`args` pair. It is a CAPABILITY ONLY — nothing in
 * `src/heartbeat/**` calls {@link ExecutionSandbox.run}. The heartbeat runner
 * merely consults the probe's `available` boolean; wiring real delegated
 * execution behind the full triple gate is deferred to Slice 4.
 *
 * Why it lives OUTSIDE `src/heartbeat/**` (ADR-002 §D5): the heartbeat static
 * guard forbids spawn/timer primitives under that tree. They belong here,
 * behind the gate, and are reusable by `bashTool` in a later refactor.
 *
 * Hardening (contrast the interactive `src/tools/builtin/bash.ts`):
 *  - SB2 env: the child environment is built from a per-platform ALLOW-LIST
 *    ONLY — never `...process.env`. Caller-supplied vars may *add* but can never
 *    override the base loader-resolution vars (PATH, and on Windows SystemRoot/
 *    COMSPEC/PATHEXT), and loader-injection vars (LD_PRELOAD, LD_LIBRARY_PATH,
 *    NODE_OPTIONS, DYLD_*) are dropped.
 *  - cwd is jailed under {@link PROJECT_ROOT} via `assertPathUnderDir` and the
 *    `deniedPathReason` policy (no `.git`, `.env`, key material, …).
 *  - shell-free: spawned with `shell:false`, so args are passed literally and
 *    no shell metacharacters are ever interpreted.
 *  - deterministic timeout, combined-output truncation, and process-tree kill
 *    mirror `bash.ts`; on timeout/truncation `exitCode` is forced to `null`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { PROJECT_ROOT, deniedPathReason } from '../policy/path.js';
import { assertPathUnderDir } from '../utils/safe_io.js';
import {
  SANDBOX_DEFAULT_MAX_OUTPUT_CHARS,
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_KILL_GRACE_MS,
  SANDBOX_MAX_OUTPUT_CHARS,
  SANDBOX_MAX_TIMEOUT_MS,
  type ExecutionSandbox,
  type SandboxExecRequest,
  type SandboxExecResult,
} from './types.js';

/** Stable identity for this sandbox implementation (no crypto needed). */
export const SANDBOX_ID = 'execution-sandbox/hardened-subprocess@1';

/** Valid POSIX-style env var name (also the bash.ts convention). */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Per-var value cap (mirror bash.ts:127). */
const MAX_ENV_VALUE_LEN = 8192;
/** Per-arg / command byte cap. */
const MAX_ARG_BYTES = 64 * 1024;

const IS_WINDOWS = process.platform === 'win32';

/**
 * Base environment allow-list, copied from the parent ONLY for these names.
 * Everything else in `process.env` (secrets, tokens, API keys, …) is excluded
 * by construction — this is the core of SB2.
 */
export const BASE_ENV_ALLOWLIST: readonly string[] = IS_WINDOWS
  ? ['PATH', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
  : ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];

/**
 * Loader-resolution vars a caller may NEVER override (SB2). Windows env names
 * are case-insensitive, so they are compared upper-cased there.
 */
const PROTECTED_ENV_KEYS: ReadonlySet<string> = IS_WINDOWS
  ? new Set(['PATH', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT'])
  : new Set(['PATH']);

function isProtectedEnvKey(key: string): boolean {
  return PROTECTED_ENV_KEYS.has(IS_WINDOWS ? key.toUpperCase() : key);
}

/**
 * Loader-injection vars a caller may NEVER set (SB2). These can make a child
 * load attacker-controlled code before its own `main`, so they are always
 * dropped regardless of platform.
 */
function isDeniedLoaderEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (upper === 'LD_PRELOAD' || upper === 'LD_LIBRARY_PATH' || upper === 'NODE_OPTIONS') return true;
  return upper.startsWith('DYLD_');
}

/**
 * Build the child environment from the base allow-list, then merge heavily
 * filtered caller additions. NEVER inherits the full parent env.
 *
 * A null-prototype object is used so a caller key like `__proto__` becomes an
 * inert own property instead of polluting the prototype chain.
 */
export function buildChildEnv(callerEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null);

  // 1) Base allow-list, copied from the parent for these names only.
  for (const name of BASE_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (typeof value === 'string') env[name] = value;
  }

  if (!callerEnv) return env;

  // 2) Caller additions — filtered. Offending entries are dropped (not fatal),
  //    so a mixed request still runs with its safe vars.
  for (const [key, value] of Object.entries(callerEnv)) {
    if (!ENV_NAME_RE.test(key)) continue; // invalid name
    if (typeof value !== 'string') continue; // non-string value
    if (value.length > MAX_ENV_VALUE_LEN) continue; // oversized
    if (value.includes('\0')) continue; // NUL byte
    if (isProtectedEnvKey(key)) continue; // SB2: cannot override base loader vars
    if (isDeniedLoaderEnvKey(key)) continue; // SB2: loader-injection vars
    env[key] = value;
  }

  return env;
}

/** Reject empty / NUL / oversized commands and args before spawning. */
function validateCommand(command: string, args: readonly string[] | undefined): void {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('sandbox: command must be a non-empty string');
  }
  if (command.includes('\0')) throw new Error('sandbox: command must not contain a NUL byte');
  if (Buffer.byteLength(command, 'utf8') > MAX_ARG_BYTES) {
    throw new Error('sandbox: command is too long');
  }
  if (args === undefined) return;
  for (const arg of args) {
    if (typeof arg !== 'string') throw new Error('sandbox: every arg must be a string');
    if (arg.includes('\0')) throw new Error('sandbox: an arg must not contain a NUL byte');
    if (Buffer.byteLength(arg, 'utf8') > MAX_ARG_BYTES) throw new Error('sandbox: an arg is too long');
  }
}

/**
 * Resolve the working directory, jailed under {@link PROJECT_ROOT}. Defaults to
 * the project root when omitted. Throws on jail escape, denied paths, or a
 * non-directory.
 */
async function resolveJailedCwd(cwd: string | undefined): Promise<string> {
  if (cwd === undefined) return PROJECT_ROOT;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('sandbox: cwd must be a non-empty string when provided');
  }
  if (cwd.includes('\0')) throw new Error('sandbox: cwd must not contain a NUL byte');
  // assertPathUnderDir throws if `cwd` escapes the jail (incl. via symlink).
  const resolved = assertPathUnderDir(cwd, PROJECT_ROOT, 'sandbox cwd');
  const denied = deniedPathReason(resolved);
  if (denied) throw new Error(`sandbox: cwd is denied (${denied})`);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`sandbox: cwd is not a directory: ${resolved}`);
  return resolved;
}

/** Floor/ceil an optional numeric budget to a fallback within [min,max]. */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Kill the child and its descendants. Windows: `taskkill /T /F`. POSIX: signal
 * the detached process group (SIGTERM, grace, SIGKILL). Mirrors bash.ts.
 */
async function killProcessTree(child: ChildProcessWithoutNullStreams, killGraceMs: number): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;

  if (IS_WINDOWS) {
    await new Promise<void>((done) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      const finish = (): void => done();
      killer.once('exit', finish);
      killer.once('error', () => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        finish();
      });
      setTimeout(finish, killGraceMs).unref();
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise<void>((done) => setTimeout(done, killGraceMs));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Build a spawn error that never leaks the env, args, or cwd. */
function sanitizeSpawnError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  return new Error(`sandbox: failed to spawn command${code ? ` (${code})` : ''}`);
}

interface SpawnParams {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputChars: number;
  killGraceMs: number;
}

/** Spawn the child shell-free and collect bounded output with a hard timeout. */
function spawnAndCollect(params: SpawnParams): Promise<SandboxExecResult> {
  const started = Date.now();

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env,
      windowsHide: true,
      detached: !IS_WINDOWS, // POSIX: new process group so we can kill the tree
      shell: false, // never interpret shell metacharacters
    });
  } catch (err) {
    return Promise.reject(sanitizeSpawnError(err));
  }

  let stdout = '';
  let stderr = '';
  let combined = 0;
  let timedOut = false;
  let truncated = false;
  let killStarted = false;

  const terminate = (reason: 'timeout' | 'output'): void => {
    if (killStarted) return;
    killStarted = true;
    if (reason === 'timeout') timedOut = true;
    else truncated = true;
    void killProcessTree(child, params.killGraceMs);
  };

  const append = (which: 'stdout' | 'stderr', chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    const remaining = params.maxOutputChars - combined;
    if (remaining > 0) {
      const slice = text.slice(0, remaining);
      if (which === 'stdout') stdout += slice;
      else stderr += slice;
      combined += slice.length;
    }
    if (text.length > remaining && !truncated) terminate('output');
  };

  child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
  child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
  child.stdin.end(); // never block on stdin

  const timer = setTimeout(() => terminate('timeout'), params.timeoutMs);

  return new Promise<SandboxExecResult>((resolveRun, rejectRun) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.once('error', (err) => settle(() => rejectRun(sanitizeSpawnError(err))));
    child.once('close', (code) =>
      settle(() =>
        resolveRun({
          stdout,
          stderr,
          // Forced null on timeout/truncation: a tree kill yields a
          // platform-specific code (Windows taskkill ⇒ 1) that is meaningless.
          exitCode: timedOut || truncated ? null : code,
          timedOut,
          truncated,
          durationMs: Date.now() - started,
        }),
      ),
    );
  });
}

/** Validate, harden, and run a single sandboxed command. */
async function runHardenedSubprocess(request: SandboxExecRequest): Promise<SandboxExecResult> {
  validateCommand(request.command, request.args);
  const cwd = await resolveJailedCwd(request.cwd);
  const env = buildChildEnv(request.env);
  const args = request.args ? [...request.args] : [];
  const timeoutMs = clampNumber(request.timeoutMs, SANDBOX_DEFAULT_TIMEOUT_MS, 1, SANDBOX_MAX_TIMEOUT_MS);
  const maxOutputChars = clampNumber(
    request.maxOutputChars,
    SANDBOX_DEFAULT_MAX_OUTPUT_CHARS,
    1,
    SANDBOX_MAX_OUTPUT_CHARS,
  );
  const killGraceMs = clampNumber(request.killGraceMs, SANDBOX_KILL_GRACE_MS, 0, SANDBOX_MAX_TIMEOUT_MS);

  return spawnAndCollect({ command: request.command, args, cwd, env, timeoutMs, maxOutputChars, killGraceMs });
}

/**
 * Construct a live hardened-subprocess sandbox. Constructing it spawns nothing;
 * the first process is created only when {@link ExecutionSandbox.run} is called.
 * Callers must still gate usage — this returns `available: true` unconditionally.
 */
export function createExecutionSandbox(): ExecutionSandbox {
  return {
    id: SANDBOX_ID,
    available: true,
    run(request: SandboxExecRequest): Promise<SandboxExecResult> {
      return runHardenedSubprocess(request);
    },
  };
}
