/**
 * Execution sandbox contracts for Nova Heartbeat V3 (ADR-002).
 *
 * Slice 1 ships the *interface only*. No implementation in this slice spawns a
 * process, opens a shell, or touches the network. A real hardened-subprocess
 * sandbox is deferred to Slice 3 (see ADR-002 §8 Q1). Until then
 * {@link ./probe.ts:probeExecutionSandbox} returns `null`, so Gate C (sandbox
 * availability) is always closed and heartbeat execution fails closed.
 *
 * This module lives OUTSIDE `src/heartbeat/**` on purpose: the heartbeat
 * static guard forbids process/scheduling primitives under that tree, and a
 * future sandbox implementation will need them here, behind the gate.
 */

/** Default wall-clock budget for a single sandboxed command. */
export const SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
/** Hard ceiling for {@link SandboxExecRequest.timeoutMs}. */
export const SANDBOX_MAX_TIMEOUT_MS = 300_000;
/** Default cap on captured stdout/stderr characters. */
export const SANDBOX_DEFAULT_MAX_OUTPUT_CHARS = 20_000;
/** Hard ceiling for {@link SandboxExecRequest.maxOutputChars}. */
export const SANDBOX_MAX_OUTPUT_CHARS = 200_000;
/** Grace period between a soft stop request and a hard kill. */
export const SANDBOX_KILL_GRACE_MS = 1_000;

/**
 * A single command the heartbeat executor would like the sandbox to run.
 *
 * The sandbox implementation (Slice 3) MUST:
 *  - resolve `cwd` under an allowed project root (src/policy/path.ts);
 *  - build the child environment from an allow-list ONLY — it must NEVER
 *    inherit `process.env` wholesale (contrast the interactive bash tool);
 *  - clamp `timeoutMs` to {@link SANDBOX_MAX_TIMEOUT_MS} and
 *    `maxOutputChars` to {@link SANDBOX_MAX_OUTPUT_CHARS}.
 */
export interface SandboxExecRequest {
  command: string;
  args?: string[];
  cwd?: string;
  /** Allow-listed environment variables ONLY; never the full parent env. */
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputChars?: number;
  killGraceMs?: number;
}

/** The outcome of a single sandboxed command. */
export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * The capability the heartbeat executor depends on. Slice 1 never obtains a
 * live instance: the probe returns `null`, so callers fail closed.
 */
export interface ExecutionSandbox {
  readonly id: string;
  /** `true` only when this sandbox can actually run a command. Always gated. */
  readonly available: boolean;
  run(request: SandboxExecRequest): Promise<SandboxExecResult>;
}
