/**
 * Heartbeat V3 triple-gate execution decision (ADR-002 §D2).
 *
 * This module is PURE: it performs no I/O, starts no timer, opens no process,
 * and reads `process.env` only through the explicit {@link readHeartbeatExecutionFlags}
 * seam (which accepts an injected env for tests). It decides *whether* the
 * heartbeat would be allowed to execute a task — it never executes anything.
 *
 * Precedence is A → C → B with a defensive safety pre-empt:
 *  - safety not 'ok'  ⇒ dry_run            (decidedBy 'task-safety')
 *  - Gate A closed    ⇒ dry_run            (decidedBy 'gate-a-flags')   ← V2-identical
 *  - Gate C closed    ⇒ refused            (decidedBy 'gate-c-sandbox') ← fail-closed
 *  - Gate B closed    ⇒ needs_user_action  (decidedBy 'gate-b-approval')
 *  - all gates open   ⇒ execute            (decidedBy 'all-gates')
 *
 * In Slice 1 the sandbox probe always reports unavailable and approvals are
 * never granted, so the reachable outcomes are dry_run (flag off) and refused
 * (flag on). `execute` and `needs_user_action` are scaffolding for later slices.
 */
import type { HeartbeatSafetyDecision } from './config.js';
import type { HeartbeatTaskKind } from './types.js';

/** Master + capability opt-in flags that compose Gate A. */
export interface HeartbeatExecutionFlags {
  /** NOVA_ENABLE_HEARTBEAT_EXEC — master switch. Off ⇒ V2-identical behaviour. */
  heartbeatExec: boolean;
  /** NOVA_ENABLE_LIVE_LLM — required when a task needs the LLM. */
  liveLlm: boolean;
  /** NOVA_ENABLE_WRITE_TOOLS — required when a task needs write tools. */
  writeTools: boolean;
}

/** What capabilities a task kind would consume if it actually ran. */
export interface HeartbeatTaskNeeds {
  llm: boolean;
  write: boolean;
}

/** Approval lifecycle status (the granted/missing axis of Gate B). */
export type HeartbeatApprovalStatus = 'none' | 'pending' | 'approved' | 'denied' | 'expired';

export interface HeartbeatExecutionApproval {
  status: HeartbeatApprovalStatus;
  approvalId?: string;
}

/** Sandbox availability axis of Gate C. */
export interface HeartbeatSandboxAvailability {
  available: boolean;
}

/** Full input to {@link decideHeartbeatExecution}. */
export interface HeartbeatExecutionGateInput {
  flags: HeartbeatExecutionFlags;
  taskNeeds: HeartbeatTaskNeeds;
  approval: HeartbeatExecutionApproval;
  sandbox: HeartbeatSandboxAvailability;
  safety: Pick<HeartbeatSafetyDecision, 'status'>;
}

export type HeartbeatExecutionMode = 'dry_run' | 'needs_user_action' | 'refused' | 'execute';

export type HeartbeatExecutionDecidedBy =
  | 'task-safety'
  | 'gate-a-flags'
  | 'gate-c-sandbox'
  | 'gate-b-approval'
  | 'all-gates';

/** The three computed gate booleans, echoed for transparency/telemetry. */
export interface HeartbeatExecutionGates {
  a: boolean;
  b: boolean;
  c: boolean;
}

export interface HeartbeatExecutionDecision {
  mode: HeartbeatExecutionMode;
  gate: HeartbeatExecutionGates;
  reason: string;
  decidedBy: HeartbeatExecutionDecidedBy;
}

const FLAG_TRUE = new Set(['1', 'true']);

/**
 * Strict opt-in predicate, byte-compatible with the existing
 * `NOVA_ENABLE_WRITE_TOOLS` / `NOVA_ENABLE_LIVE_LLM` checks: only the exact
 * strings "1" or "true" enable a flag; everything else (including undefined)
 * is off.
 */
export function isHeartbeatFlagEnabled(value: string | undefined): boolean {
  return value !== undefined && FLAG_TRUE.has(value);
}

/** Read the three execution flags from an injected (or the process) env. */
export function readHeartbeatExecutionFlags(env: NodeJS.ProcessEnv = process.env): HeartbeatExecutionFlags {
  return {
    heartbeatExec: isHeartbeatFlagEnabled(env.NOVA_ENABLE_HEARTBEAT_EXEC),
    liveLlm: isHeartbeatFlagEnabled(env.NOVA_ENABLE_LIVE_LLM),
    writeTools: isHeartbeatFlagEnabled(env.NOVA_ENABLE_WRITE_TOOLS),
  };
}

/**
 * Map a task kind to the capabilities it would consume. The kind union widens
 * to `string`, so the `default` branch keeps unknown kinds maximally safe
 * (no LLM, no writes).
 */
export function heartbeatTaskNeeds(kind: HeartbeatTaskKind): HeartbeatTaskNeeds {
  switch (kind) {
    case 'eval':
      return { llm: true, write: false };
    case 'maintenance':
      return { llm: false, write: true };
    case 'inspection':
    case 'batch-dry-run':
    default:
      return { llm: false, write: false };
  }
}

/**
 * Gate A — composed master + capability flags. Open only when the master
 * switch is on AND every capability the task needs is separately enabled.
 */
export function heartbeatGateA(flags: HeartbeatExecutionFlags, needs: HeartbeatTaskNeeds): boolean {
  if (!flags.heartbeatExec) return false;
  if (needs.llm && !flags.liveLlm) return false;
  if (needs.write && !flags.writeTools) return false;
  return true;
}

/**
 * Pure triple-gate decision. See the module header for the full precedence and
 * truth table. Never executes; only classifies.
 */
export function decideHeartbeatExecution(input: HeartbeatExecutionGateInput): HeartbeatExecutionDecision {
  const a = heartbeatGateA(input.flags, input.taskNeeds);
  const b = input.approval.status === 'approved';
  const c = input.sandbox.available === true;
  const gate: HeartbeatExecutionGates = { a, b, c };

  // Defensive pre-empt: a task that is not classified 'ok' is NEVER executed,
  // regardless of flags/approval/sandbox. Guarantees FORBIDDEN/dangerous kinds
  // can never reach 'execute'.
  if (input.safety.status !== 'ok') {
    return { mode: 'dry_run', gate, reason: 'Task safety is not ok; execution is never attempted.', decidedBy: 'task-safety' };
  }

  // Gate A — flags. Off ⇒ byte-identical to V2 dry-run.
  if (!a) {
    return { mode: 'dry_run', gate, reason: 'Heartbeat execution flags are off; dry-run only.', decidedBy: 'gate-a-flags' };
  }

  // Gate C — sandbox availability. Fail-closed: no sandbox ⇒ refuse; never fall
  // back to an unsandboxed shell.
  if (!c) {
    return { mode: 'refused', gate, reason: 'No execution sandbox is available; fail-closed refuse.', decidedBy: 'gate-c-sandbox' };
  }

  // Gate B — explicit approval. Missing ⇒ needs user action.
  if (!b) {
    return { mode: 'needs_user_action', gate, reason: 'Execution requires a granted approval.', decidedBy: 'gate-b-approval' };
  }

  return { mode: 'execute', gate, reason: 'All execution gates are open; delegated execution permitted.', decidedBy: 'all-gates' };
}
