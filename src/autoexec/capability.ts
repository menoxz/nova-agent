/**
 * Delegated execution capability for the heartbeat (ADR-002 Slice 4, design D3).
 *
 * This module lives OUTSIDE `src/heartbeat/**` on purpose: it is the seam where
 * real process execution is composed, so the heartbeat static guard never has
 * to see a process/timer primitive. The heartbeat injects this capability
 * through the {@link HeartbeatExecutionCapability} port and only ever calls
 * `.run` — it constructs no runner of its own.
 *
 * It wraps the frozen Slice-3 {@link ExecutionSandbox} (the real Gate C). It is
 * a CALLER of the sandbox; it does not modify it.
 *
 * CAVEAT-5 (producer-side redaction): the mapping from `SandboxExecResult` →
 * {@link HeartbeatExecOutcome} DROPS the stdout/stderr bodies entirely. The
 * `summary` is metadata-only (exit code + duration), never raw output, never
 * env, never secrets.
 */
import type { ExecutionSandbox, SandboxExecRequest } from '../sandbox/types.js';
import type {
  HeartbeatExecOutcome,
  HeartbeatExecRequest,
  HeartbeatExecutionCapability,
} from '../heartbeat/executor.js';

/** Dependencies for {@link createDelegatedExecutionCapability}. */
export interface DelegatedExecutionDeps {
  /** The Gate C sandbox (e.g. `createExecutionSandbox()`). */
  sandbox: ExecutionSandbox;
  /**
   * Command to run. Defaults to the current Node binary — an always-present,
   * side-effect-free probe (`node --version`) suitable for the inspection kind.
   */
  command?: string;
  /** Literal args (shell-free). Defaults to `['--version']`. */
  args?: readonly string[];
  /** Per-run timeout budget in ms (clamped by the sandbox). */
  timeoutMs?: number;
}

/**
 * Build a {@link HeartbeatExecutionCapability} backed by the hardened sandbox.
 *
 * The returned `run` is fail-soft at its OWN boundary: a sandbox rejection is
 * caught and reported as `{ ok: false }` with a metadata-only summary, so the
 * heartbeat's R3 try/catch is belt-and-braces rather than the only guard. No
 * caller env is forwarded — the sandbox's own allow-list is the sole env source.
 */
export function createDelegatedExecutionCapability(
  deps: DelegatedExecutionDeps,
): HeartbeatExecutionCapability {
  const command = deps.command ?? process.execPath;
  const args = deps.args ? [...deps.args] : ['--version'];
  return {
    async run(req: HeartbeatExecRequest): Promise<HeartbeatExecOutcome> {
      const request: SandboxExecRequest = {
        command,
        args,
        // No caller env: the sandbox builds a hardened allow-list itself (SB2).
        env: {},
        ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      };
      try {
        const result = await deps.sandbox.run(request);
        // CAVEAT-5: discard stdout/stderr bodies; keep metadata only.
        const ok = result.exitCode === 0 && !result.timedOut && !result.truncated;
        return {
          ok,
          summary: summarize(req.kind, result.exitCode, result.durationMs, result.timedOut, result.truncated),
          exitCode: result.exitCode ?? undefined,
          durationMs: result.durationMs,
        };
      } catch {
        // The sandbox sanitises its own errors; surface a metadata-only failure.
        return { ok: false, summary: `task=${req.kind} run failed before completion` };
      }
    },
  };
}

/** Metadata-only one-line summary. NEVER includes output, env, args, or secrets. */
function summarize(
  kind: string,
  exitCode: number | null,
  durationMs: number,
  timedOut: boolean,
  truncated: boolean,
): string {
  const parts = [`task=${kind}`, `exit=${exitCode === null ? 'null' : exitCode}`, `dur=${durationMs}ms`];
  if (timedOut) parts.push('timedOut');
  if (truncated) parts.push('truncated');
  return parts.join(' ');
}
