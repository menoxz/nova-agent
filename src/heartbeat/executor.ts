/**
 * Heartbeat V3 Slice 4b — cross-tick approval lifecycle + session-bridge ports
 * (ADR-002 §D7, §SEC).
 *
 * This module is PURE with respect to scheduling and process control: it starts
 * no timer, opens no process, runs no shell, and performs NO session-store I/O.
 * It threads an injected `now` clock and two injectable *ports* — a read-only
 * approval gateway and an approval requester — so the runner can request a fresh
 * approval, resolve a pending one, honour a 24h expiry, and persist the decision
 * under .nova/heartbeat/ ONLY. Both ports are plain-data seams whose session-
 * machinery implementations live in src/autoexec/** and are injected by the CLI,
 * so src/heartbeat/** never imports ../session/ or ../tools/ (not even types).
 *
 * With NO requester wired (the default) an approval is minted purely in the
 * synthetic `hb-appr-*` namespace and no session approval is created, so the
 * gateway always reads 'pending' (Slice-2 behaviour, byte-identical). With the
 * requester wired the mint ALSO creates a real session approval and persists the
 * (approvalId, runId, sessionId) locator beside the hb-appr id; the gateway then
 * resolves that locator to the operator's verdict.
 *
 * It LISTS/READS approvals through the gateway and NEVER resolves them to a
 * verdict itself: the gate's own write primitive is forbidden here by the §D6
 * static guard, so the heartbeat can never grant or deny its own approvals.
 */
import { randomUUID } from 'node:crypto';

import type { HeartbeatApprovalStatus, HeartbeatExecutionFlags } from './execution_gate.js';
import { decideHeartbeatExecution, heartbeatTaskNeeds } from './execution_gate.js';
import type { HeartbeatTaskConfig, HeartbeatTaskKind, HeartbeatTaskResult, HeartbeatTaskState } from './types.js';

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
 * Locator tying a heartbeat-minted `hb-appr-*` id to a real approval in the
 * session namespace (ADR-002 Slice 4b §SEC-B2). All three fields are required to
 * address a single approval; a partial locator is treated as "no link" and
 * resolves 'pending' (fail-closed). This is plain data — no session type ever
 * crosses into src/heartbeat/**.
 */
export interface HeartbeatSessionApprovalLink {
  sessionApprovalId: string;
  sessionRunId: string;
  sessionId: string;
}

/**
 * Injectable read-only approval port. Heartbeat may LIST/READ an approval by id
 * (optionally narrowed by a {@link HeartbeatSessionApprovalLink}) but NEVER
 * writes a verdict for it. `resolve` maps a pending approval to its current
 * lifecycle status.
 */
export interface HeartbeatApprovalGateway {
  resolve(approvalId: string, locator?: HeartbeatSessionApprovalLink): Promise<HeartbeatApprovalResolution>;
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
 * Secret-free approval request handed to the {@link HeartbeatApprovalRequester}.
 * Carries only the task identity, kind, and the fixed capability category a
 * heartbeat execution would need — never prompts, env, or secrets.
 */
export interface HeartbeatApprovalRequest {
  taskId: string;
  kind: HeartbeatTaskKind;
  capability: 'shell';
}

/**
 * Injectable approval *requester* port (ADR-002 Slice 4b §SEC). When wired, the
 * heartbeat asks it to create a real session approval at mint time and hands back
 * the {@link HeartbeatSessionApprovalLink} to persist. It NEVER decides an
 * approval. A rejected/throwing request yields `undefined`, so the mint falls
 * back to a synthetic-only `hb-appr-*` id (fail-closed; no session linkage).
 */
export interface HeartbeatApprovalRequester {
  request(req: HeartbeatApprovalRequest): Promise<HeartbeatSessionApprovalLink | undefined>;
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
  | { kind: 'mint'; approvalId: string; at: string; link?: HeartbeatSessionApprovalLink }
  | { kind: 'await' }
  | { kind: 'blocked'; approvalId: string }
  | { kind: 'reset' }
  | { kind: 'executed'; approvalId?: string; at: string };

/**
 * Minimal, secret-free execution request handed to the delegated capability.
 * Carries only the task identity and kind — never prompts, env, or secrets.
 */
export interface HeartbeatExecRequest {
  taskId: string;
  kind: HeartbeatTaskKind;
}

/**
 * Metadata-only outcome of a delegated execution. `summary` is surfaced ONLY
 * through the redacted `result.reason` (redaction.ts:41) — never as a new field
 * on the result/report/state (BLOCKER-2). It must never carry raw output, env,
 * or secrets (CAVEAT-5); fold any exit/duration detail into the text.
 */
export interface HeartbeatExecOutcome {
  ok: boolean;
  summary: string;
  exitCode?: number;
  durationMs?: number;
}

/**
 * Injectable delegated-execution port. The heartbeat NEVER constructs a runner
 * itself; it only invokes `.run` on this seam, so every process-control and
 * timer primitive stays outside src/heartbeat/** (ADR-002 §D5). The production
 * wiring lives in src/autoexec/**.
 */
export interface HeartbeatExecutionCapability {
  run(req: HeartbeatExecRequest): Promise<HeartbeatExecOutcome>;
}

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
  /** Injected delegated-execution port (S4). Absent at row 8 ⇒ fail-closed refuse. */
  capability?: HeartbeatExecutionCapability;
  /**
   * Injected approval requester (S4b). Absent ⇒ the mint stays synthetic-only and
   * no session approval is created (Slice-2 byte-identical behaviour).
   */
  requester?: HeartbeatApprovalRequester;
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
  const { planned, task, taskState, flags, sandboxAvailable, gateway, now, capability, requester } = input;
  if (planned.status !== 'due') return { result: planned, patch: { kind: 'none' } };

  const pendingId = taskState?.pendingApprovalId;
  const locator = sessionApprovalLocator(taskState);
  const approvalStatus = await resolveApprovalStatus(pendingId, taskState?.pendingApprovalAt, locator, gateway, now);

  const decision = decideHeartbeatExecution({
    flags,
    taskNeeds: heartbeatTaskNeeds(task.kind),
    approval: { status: approvalStatus, approvalId: pendingId },
    sandbox: { available: sandboxAvailable },
    safety: { status: 'ok' },
  });

  switch (decision.mode) {
    case 'execute':
      // Row 8 — all gates open. Delegate to the injected capability (the
      // heartbeat constructs no runner of its own) and map the metadata-only
      // outcome to a result + approval patch. Fail-closed + trust-bounded (D9).
      return resolveDelegatedExecution(planned, task, pendingId, capability, now);
    case 'refused':
      // Gate C fail-closed (no sandbox). Transient; a pending approval is kept.
      return {
        result: { ...planned, status: 'refused', reason: decision.reason },
        patch: { kind: 'refused' },
      };
    case 'needs_user_action':
      return resolveNeedsUserAction(planned, decision.reason, pendingId, approvalStatus, now, task, requester);
    case 'dry_run':
    default:
      // Flags off (V2 parity) or any unmodelled mode: leave the task as planned.
      return { result: planned, patch: { kind: 'none' } };
  }
}

/**
 * Row-8 delegated execution (ADR-002 §D9). The heartbeat owns NO runner: it
 * invokes the injected capability's `.run` and maps the metadata-only outcome
 * to a result + state patch.
 *  - no capability wired       ⇒ refuse, grant RETAINED  (transient; R1 / D5)
 *  - capability throws/rejects ⇒ refuse, grant CONSUMED  (R3 trust boundary)
 *  - outcome.ok === false      ⇒ refuse, grant CONSUMED  (failure summary → reason)
 *  - outcome.ok === true       ⇒ executed, grant CONSUMED (summary → reason)
 * `summary` reaches the report ONLY through the redacted `reason` (redaction.ts:41);
 * no result/report/state field carries it (BLOCKER-2).
 */
async function resolveDelegatedExecution(
  planned: HeartbeatTaskResult,
  task: HeartbeatTaskConfig,
  pendingId: string | undefined,
  capability: HeartbeatExecutionCapability | undefined,
  now: Date,
): Promise<HeartbeatEvaluation> {
  if (capability === undefined) {
    return {
      result: { ...planned, status: 'refused', reason: 'No execution capability is wired; fail-closed refuse.' },
      patch: { kind: 'refused' },
    };
  }
  let outcome: HeartbeatExecOutcome;
  try {
    outcome = await capability.run({ taskId: task.id, kind: task.kind });
  } catch {
    // R3 trust boundary: a delegated failure NEVER propagates out of the tick.
    return {
      result: { ...planned, status: 'refused', reason: 'Delegated execution failed; refused.' },
      patch: { kind: 'blocked', approvalId: pendingId ?? '' },
    };
  }
  if (!outcome.ok) {
    return {
      result: { ...planned, status: 'refused', reason: outcome.summary },
      patch: { kind: 'blocked', approvalId: pendingId ?? '' },
    };
  }
  return {
    result: { ...planned, status: 'executed', reason: outcome.summary },
    patch: { kind: 'executed', approvalId: pendingId, at: now.toISOString() },
  };
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
  locator: HeartbeatSessionApprovalLink | undefined,
  gateway: HeartbeatApprovalGateway,
  now: Date,
): Promise<HeartbeatApprovalStatus> {
  if (pendingId === undefined) return 'none';
  if (isHeartbeatApprovalExpired(pendingAt, now)) return 'expired';
  try {
    // §SEC-B1 fail-closed: any error reading the approval port keeps the task
    // pending (it never auto-grants). The gateway performs the session-store read.
    return await gateway.resolve(pendingId, locator);
  } catch {
    return 'pending';
  }
}

/**
 * Build the session locator from a task's persisted bridge fields. Returns
 * undefined unless all three components are present, so a partial or legacy
 * state (e.g. a Slice-2 synthetic-only mint) resolves with no session linkage.
 */
function sessionApprovalLocator(taskState: HeartbeatTaskState | undefined): HeartbeatSessionApprovalLink | undefined {
  if (taskState === undefined) return undefined;
  const { pendingSessionApprovalId, pendingSessionRunId, pendingSessionId } = taskState;
  if (pendingSessionApprovalId === undefined || pendingSessionRunId === undefined || pendingSessionId === undefined) {
    return undefined;
  }
  return { sessionApprovalId: pendingSessionApprovalId, sessionRunId: pendingSessionRunId, sessionId: pendingSessionId };
}

/**
 * Map a Gate B `needs_user_action` outcome to a concrete result + state patch:
 *  - no pending id      ⇒ mint a fresh approval, report needs_user_action (single-shot)
 *  - pending 'denied'   ⇒ block the task and discard the request
 *  - pending 'expired'  ⇒ reset so the next tick mints anew
 *  - still pending      ⇒ keep waiting on the same approval id
 *
 * At mint time, when a requester is wired (S4b), a real session approval is also
 * created and its locator persisted beside the synthetic id; otherwise the mint
 * stays synthetic-only (no session linkage). Requesting NEVER decides.
 */
async function resolveNeedsUserAction(
  planned: HeartbeatTaskResult,
  gateReason: string,
  pendingId: string | undefined,
  approvalStatus: HeartbeatApprovalStatus,
  now: Date,
  task: HeartbeatTaskConfig,
  requester: HeartbeatApprovalRequester | undefined,
): Promise<HeartbeatEvaluation> {
  if (pendingId === undefined) {
    const approvalId = mintHeartbeatApprovalId();
    const link = await requestSessionApprovalLink(requester, task);
    return {
      result: { ...planned, status: 'needs_user_action', reason: `Execution requires approval ${approvalId}; awaiting user decision.` },
      patch: link === undefined ? { kind: 'mint', approvalId, at: now.toISOString() } : { kind: 'mint', approvalId, at: now.toISOString(), link },
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
 * Ask the injected requester to create a real session approval for this task and
 * return its locator. §SEC-B1 fail-closed: a missing requester or any
 * rejection/throw yields undefined, so the mint stays synthetic-only. The
 * request carries only the task identity/kind and the fixed 'shell' capability.
 */
async function requestSessionApprovalLink(
  requester: HeartbeatApprovalRequester | undefined,
  task: HeartbeatTaskConfig,
): Promise<HeartbeatSessionApprovalLink | undefined> {
  if (requester === undefined) return undefined;
  try {
    return await requester.request({ taskId: task.id, kind: task.kind, capability: 'shell' });
  } catch {
    return undefined;
  }
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
    case 'mint': {
      const minted: HeartbeatTaskState = { ...base, pendingApprovalId: patch.approvalId, pendingApprovalAt: patch.at, lastExecStatus: 'needs_user_action' };
      if (patch.link !== undefined) {
        minted.pendingSessionApprovalId = patch.link.sessionApprovalId;
        minted.pendingSessionRunId = patch.link.sessionRunId;
        minted.pendingSessionId = patch.link.sessionId;
      }
      return minted;
    }
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
  delete next.pendingSessionApprovalId;
  delete next.pendingSessionRunId;
  delete next.pendingSessionId;
  return next;
}
