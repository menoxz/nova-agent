import type { ExecutionSandbox } from './types.js';

/**
 * Probe for an available execution sandbox.
 *
 * Slice 1 (ADR-002) ships fail-closed: there is no sandbox implementation yet,
 * so this always returns `null`. Callers MUST treat `null` as "Gate C closed"
 * and refuse heartbeat execution rather than falling back to an unsandboxed
 * shell. A real hardened-subprocess probe lands in Slice 3 (ADR-002 §8 Q1).
 *
 * @returns `null` for the entirety of ADR-002 Slice 1.
 */
export function probeExecutionSandbox(): ExecutionSandbox | null {
  return null;
}
