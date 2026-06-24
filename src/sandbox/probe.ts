import { isHeartbeatFlagEnabled } from '../heartbeat/execution_gate.js';
import { createExecutionSandbox } from './sandbox.js';
import { sandboxIsSupportedPlatform } from './platform.js';
import type { ExecutionSandbox } from './types.js';

/**
 * Probe for an available execution sandbox (ADR-002 Slice 3, SB1).
 *
 * Fail-closed and opt-in. The real hardened-subprocess sandbox
 * ({@link ./sandbox.ts}) is returned ONLY when both hold:
 *  1. `NOVA_ENABLE_EXEC_SANDBOX` is strictly enabled ("1" or "true" — same
 *     opt-in semantics as every other Nova capability flag, via
 *     {@link isHeartbeatFlagEnabled}); and
 *  2. the current platform implements verified process-tree teardown
 *     ({@link sandboxIsSupportedPlatform}).
 *
 * Otherwise this returns `null`, which callers MUST treat as "Gate C closed"
 * and refuse heartbeat execution rather than falling back to an unsandboxed
 * shell. Returning a sandbox here grants only the *capability*; the heartbeat
 * triple gate (flags + approval + sandbox) still governs whether anything runs.
 *
 * This is pure and side-effect free: it constructs no process and starts no
 * timer. The first subprocess is created only if a caller invokes
 * {@link ExecutionSandbox.run}.
 *
 * @param env Defaults to `process.env`; injectable for tests.
 * @returns a live sandbox when opted in on a supported platform, else `null`.
 */
export function probeExecutionSandbox(env: NodeJS.ProcessEnv = process.env): ExecutionSandbox | null {
  if (!isHeartbeatFlagEnabled(env.NOVA_ENABLE_EXEC_SANDBOX)) return null;
  if (!sandboxIsSupportedPlatform()) return null;
  return createExecutionSandbox();
}
