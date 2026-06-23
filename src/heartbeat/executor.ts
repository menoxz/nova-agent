/**
 * Heartbeat V3 Slice 2 — cross-tick approval lifecycle (ADR-002 §D7).
 *
 * This module is PURE with respect to scheduling and process control: it starts
 * no timer, opens no process, runs no shell, and performs NO session-store I/O.
 * It threads an injected `now` clock and an injectable approval-gateway *port*
 * so the runner can resolve a pending approval, mint a fresh approval id, honour
 * a 24h expiry, and persist the resulting decision under .nova/heartbeat/ ONLY.
 *
 * The production gateway is a zero-I/O stub that always reports 'pending':
 * heartbeat-minted approval ids live in a synthetic `hb-appr-*` namespace that
 * never collides with a real session approval id, so reading the session store
 * would always yield 'pending' anyway — and the session-machinery bridge is
 * deliberately deferred to Slice 4 (the gateway is the seam where it will land).
 *
 * It LISTS/READS approvals through the port and NEVER resolves them to a verdict
 * itself: the gate's own write primitive is forbidden here by the §D6 static
 * guard, so the heartbeat can never grant or deny its own approvals.
 */
import { randomUUID } from 'node:crypto';

import type { HeartbeatApprovalStatus, HeartbeatExecutionFlags } from './execution_gate.js';
import { decideHeartbeatExecution, heartbeatTaskNeeds } from './execution_gate.js';
import type { HeartbeatTaskConfig, HeartbeatTaskResult, HeartbeatTaskState } from './types.js';

/** 24h approval validity window (ADR-002 §D7). */
export const HEARTBEAT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Synthetic namespace for heartbeat-minted approval ids (never a session id). */
const HEARTBEAT_APPROVAL_ID_PREFIX = 'hb-appr-';

/**
 * A resolved approval is the granted/denied/expired/pending axis of Gate B —
 * i.e. every {@link HeartbeatApprovalStatus} except the synthetic 'none' that
 * means "no approval has ever been requested for this task".
 */
export type HeartbeatApprovalResolution = Exclude<HeartbeatApprovalStatus, 'none'>;

/**
 * Injectable read-only approval port. Heartbeat may LIST/READ an approval by id
 * but NEVER write a verdict for it. `resolve` maps a pending approval id to its
 * current lifecycle status.
 */
export interface HeartbeatApprovalGateway {
  resolve(approvalId: string): Promise<HeartbeatApprovalResolution>;
}

/**
 * Production gateway: a zero-I/O stub. It reads nothing (no session store, no
 * .nova/sessions/) and always reports 'pending'. See the module header for why
 * this is behaviourally complete for Slice 2; Slice 4 swaps in the real
 * session-machinery bridge behind this same port.
 */
export function createReadOnlyApprovalGateway(): HeartbeatApprovalGateway {
  return {
    async resolve(): Promise<HeartbeatApprovalResolution> {
      return 'pending';
    },
  };
}

/** Mint a fresh heartbeat approval id in the synthetic `hb-appr-*` namespace. */
export function mintHeartbeatApprovalId(): string {
  return `${HEARTBEAT_APPROVAL_ID_PREFIX}${randomUUID()}`;
}

/**
 * A pending approval is expired once {@link HEARTBEAT_APPROVAL_TTL_MS} has
 * elapsed since it was requested. Fail-safe: a missing or unparseable
 * `requestedAt` is treated as expired, so a corrupt timestamp can never keep a
 * stale approval alive.
 */
export function isHeartbeatApprovalExpired(requestedAt: string | undefined, now: Date): boolean {
  if (requestedAt === undefined) return true;
  const requestedMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedMs)) return true;
  return now.getTime() - requestedMs >= HEARTBEAT_APPROVAL_TTL_MS;
}

/**
 * A pure state patch describing how a single task's persisted approval
 * bookkeeping changes after this tick. Applied by
 * {@link applyHeartbeatApprovalPatch} on top of the base task state.
 */
export type HeartbeatApprovalPatch =
  | { kind: 'none' }
  | { kind: 'refused' }
  | { kind: 'mint'; approvalId: string; at: string }
  | { kind: 'await' }
  | { kind: 'blocked'; approvalId: string }
  | { kind: 'reset' }
  | { kind: 'executed'; approvalId?: string; at: string };

export interface HeartbeatEvaluationInput {
  /** The V2 planner result for this task (status due/skipped/blocked/...). */
  planned: HeartbeatTaskResult;
  task: HeartbeatTaskConfig;
  /** Prior persisted state for this task, if any (carries pending approval). */
  taskState: HeartbeatTaskState | undefined;
  flags: HeartbeatExecutionFlags;
  sandboxAvailable: boolean;
  gateway: HeartbeatApprovalGateway;
  now: Date;
}

export interface HeartbeatEvaluation {
  result: HeartbeatTaskResult;
  patch: HeartbeatApprovalPatch;
}

/**
 * Evaluate one planned task through the ADR-002 triple-gate plus the Slice 2
 * cross-tick approval lifecycle. Only a 'due' task is subject to the gate; every
 * other status (skipped/blocked/needs_user_action/...) passes through untouched,
 * so dangerous kinds — already non-'due' from classification — can never run.
 *
 * With execution flags OFF the gate returns 'dry_run' and the task is returned
 * exactly as planned (byte-identical to V2, SI-1).
 */
export async function evaluateHeartbeatExecution(input: HeartbeatEvaluationInput): Promise<HeartbeatEvaluation> {
  const { planned, task, taskState, flags, sandboxAvailable, gateway, now } = input;
  if (planned.status !== 'due') return { result: planned, patch: { kind: 'none' } };

  const pendingId = taskState?.pendingApprovalId;
  const approvalStatus = await resolveApprovalStatus(pendingId, taskState?.pendingApprovalAt, gateway, now);

  const decision = decideHeartbeatExecution({
    flags,
    taskNeeds: heartbeatTaskNeeds(task.kind),
    approval: { status: approvalStatus, approvalId: pendingId },
    sandbox: { available: sandboxAvailable },
    safety: { status: 'ok' },
  });

  switch (decision.mode) {
    case 'execute':
      // All gates open: the pending approval is granted. Persist the run and
      // clear the pending request so the next due tick must re-request (SI-9).
      return {
        result: { ...planned, status: 'executed', reason: decision.reason },
        patch: { kind: 'executed', approvalId: pendingId, at: now.toISOString() },
      };
    case 'refused':
      // Gate C fail-closed (no sandbox). Transient; a pending approval is kept.
      return {
        result: { ...planned, status: 'refused', reason: decision.reason },
        patch: { kind: 'refused' },
      };
    case 'needs_user_action':
      return resolveNeedsUserAction(planned, decision.reason, pendingId, approvalStatus, now);
    case 'dry_run':
    default:
      // Flags off (V2 parity) or any unmodelled mode: leave the task as planned.
      return { result: planned, patch: { kind: 'none' } };
  }
}

/**
 * Resolve the current approval status for a task. Returns 'none' when no
 * approval has ever been requested (the only path that skips the gateway). A
 * pending approval older than the TTL is reported 'expired' regardless of what
 * the gateway says, so a stale grant can never slip through.
 */
async function resolveApprovalStatus(
  pendingId: string | undefined,
  pendingAt: string | undefined,
  gateway: HeartbeatApprovalGateway,
  now: Date,
): Promise<HeartbeatApprovalStatus> {
  if (pendingId === undefined) return 'none';
  if (isHeartbeatApprovalExpired(pendingAt, now)) return 'expired';
  return gateway.resolve(pendingId);
}

/**
 * Map a Gate B `needs_user_action` outcome to a concrete result + state patch:
 *  - no pending id      ⇒ mint a fresh approval, report needs_user_action (single-shot)
 *  - pending 'denied'   ⇒ block the task and discard the request
 *  - pending 'expired'  ⇒ reset so the next tick mints anew
 *  - still pending      ⇒ keep waiting on the same approval id
 */
function resolveNeedsUserAction(
  planned: HeartbeatTaskResult,
  gateReason: string,
  pendingId: string | undefined,
  approvalStatus: HeartbeatApprovalStatus,
  now: Date,
): HeartbeatEvaluation {
  if (pendingId === undefined) {
    const approvalId = mintHeartbeatApprovalId();
    return {
      result: { ...planned, status: 'needs_user_action', reason: `Execution requires approval ${approvalId}; awaiting user decision.` },
      patch: { kind: 'mint', approvalId, at: now.toISOString() },
    };
  }
  if (approvalStatus === 'denied') {
    return {
      result: { ...planned, status: 'blocked', reason: `Approval ${pendingId} was denied; execution is blocked.` },
      patch: { kind: 'blocked', approvalId: pendingId },
    };
  }
  if (approvalStatus === 'expired') {
    return {
      result: { ...planned, status: 'needs_user_action', reason: `Approval ${pendingId} expired; a new approval is required.` },
      patch: { kind: 'reset' },
    };
  }
  return {
    result: { ...planned, status: 'needs_user_action', reason: gateReason },
    patch: { kind: 'await' },
  };
}

/**
 * Apply an approval patch to the base task state produced by the tick. `base`
 * already carries the V2 `lastDryRunAt` / `lastStatus` bookkeeping; this only
 * layers the ADR-002 execution/approval fields on top. Pure: no clock, no I/O.
 */
export function applyHeartbeatApprovalPatch(base: HeartbeatTaskState, patch: HeartbeatApprovalPatch): HeartbeatTaskState {
  switch (patch.kind) {
    case 'none':
      return base;
    case 'refused':
      return { ...base, lastExecStatus: 'refused' };
    case 'await':
      return { ...base, lastExecStatus: 'needs_user_action' };
    case 'mint':
      return { ...base, pendingApprovalId: patch.approvalId, pendingApprovalAt: patch.at, lastExecStatus: 'needs_user_action' };
    case 'reset':
      return { ...withoutPending(base), lastExecStatus: 'needs_user_action' };
    case 'blocked':
      // A denial is a terminal refusal for this request; lastExecStatus has no
      // dedicated 'denied' member, so 'refused' carries it (the denied id is
      // retained in lastApprovalId for the audit trail).
      return { ...withoutPending(base), lastExecStatus: 'refused', lastApprovalId: patch.approvalId };
    case 'executed':
      return {
        ...withoutPending(base),
        lastRunAt: patch.at,
        lastExecAt: patch.at,
        lastExecStatus: 'executed',
        lastApprovalId: patch.approvalId ?? base.lastApprovalId,
      };
  }
}

/** Build a copy of `state` with the pending-approval fields cleared. */
function withoutPending(state: HeartbeatTaskState): HeartbeatTaskState {
  const next = { ...state };
  delete next.pendingApprovalId;
  delete next.pendingApprovalAt;
  return next;
}
