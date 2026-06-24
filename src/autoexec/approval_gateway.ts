/**
 * Heartbeat ↔ session approval bridge (ADR-002 Heartbeat V3, Slice 4b §SEC).
 *
 * This module is the ONLY place that binds the heartbeat's approval ports to the
 * real session machinery, and the ONLY heartbeat-facing code that performs
 * .nova/sessions/ I/O. It lives OUTSIDE src/heartbeat/** on purpose: the
 * heartbeat static guard forbids src/heartbeat/** from importing ../session/ or
 * ../tools/ (even as types), so the CLI imports this factory instead and injects
 * the resulting plain-data ports into a tick.
 *
 * It binds three seams against ONE shared SessionRuntimeConfig (a single
 * projectRoot ⇒ a single .nova/sessions/ store), so the approval a heartbeat
 * mints through the requester is the exact approval the gateway later reads:
 *
 *   requester  — createSession → startRun → requestApproval (SessionRunManager);
 *                returns the (approvalId, runId, sessionId) locator to persist.
 *                It NEVER decides an approval.
 *   gateway    — list() approvals (ApprovalManager) and resolve a locator to the
 *                operator's verdict. Read-only: it never decides an approval.
 *   capability — the frozen Slice-3 sandbox wrapped as a delegated-exec port.
 *
 * §SEC fail-closed: the gateway maps a missing/partly-matched locator to
 * 'pending' and never auto-grants. Error handling at the port boundary is owned
 * by the heartbeat executor (resolveApprovalStatus / requestSessionApprovalLink),
 * which wraps every call in a try/catch, so a thrown store error degrades to
 * 'pending' / synthetic-only rather than leaking or failing open.
 */
import { ApprovalManager } from '../approval/manager.js';
import { SessionRunManager } from '../session/manager.js';
import type { ApprovalDecision, SessionRuntimeConfig } from '../session/types.js';
import { createExecutionSandbox } from '../sandbox/sandbox.js';
import { createDelegatedExecutionCapability } from './capability.js';
import type {
  HeartbeatApprovalGateway,
  HeartbeatApprovalRequest,
  HeartbeatApprovalRequester,
  HeartbeatApprovalResolution,
  HeartbeatExecutionCapability,
  HeartbeatSessionApprovalLink,
} from '../heartbeat/executor.js';

/** The injectable ports the CLI wires into a heartbeat tick when execution is armed. */
export interface HeartbeatApprovalBridge {
  gateway: HeartbeatApprovalGateway;
  requester: HeartbeatApprovalRequester;
  capability: HeartbeatExecutionCapability;
}

/**
 * Build the heartbeat ↔ session bridge for a project. Both managers share one
 * SessionRuntimeConfig (hence one .nova/sessions/ store under `projectRoot`), so
 * the requester's writes and the gateway's reads address the same approvals.
 */
export function createHeartbeatApprovalBridge(options: { projectRoot: string }): HeartbeatApprovalBridge {
  const config: SessionRuntimeConfig = { projectRoot: options.projectRoot };
  const sessions = new SessionRunManager(config);
  const approvals = new ApprovalManager(config);
  return {
    gateway: createSessionApprovalGateway(approvals),
    requester: createSessionApprovalRequester(sessions),
    capability: createDelegatedExecutionCapability({ sandbox: createExecutionSandbox() }),
  };
}

/**
 * Read-only approval gateway backed by {@link ApprovalManager}. Resolves a
 * heartbeat locator to the operator's verdict by matching the FULL composite key
 * (sessionId, runId, approvalId) against the listed approvals (§SEC-B2): a run id
 * is globally unique, so the (runId, approvalId) pair addresses exactly one
 * approval and a synthetic `approval_N` id can never collide across runs. A
 * missing locator, a partial match, or an unknown id all resolve 'pending'
 * (fail-closed). It LISTS only — it never decides an approval, so the heartbeat can
 * never grant or deny its own approvals.
 */
export function createSessionApprovalGateway(approvals: ApprovalManager): HeartbeatApprovalGateway {
  return {
    async resolve(
      _approvalId: string,
      locator?: HeartbeatSessionApprovalLink,
    ): Promise<HeartbeatApprovalResolution> {
      if (locator === undefined) return 'pending';
      const items = await approvals.list();
      const match = items.find(
        (item) =>
          item.sessionId === locator.sessionId &&
          item.runId === locator.sessionRunId &&
          item.approvalId === locator.sessionApprovalId,
      );
      if (match === undefined) return 'pending';
      return toResolution(match.status);
    },
  };
}

/**
 * Approval requester backed by {@link SessionRunManager}. At heartbeat mint time
 * it opens a fresh session + run and records a single high-risk 'shell' approval,
 * then returns its (approvalId, runId, sessionId) locator. The request carries
 * ONLY the task identity/kind and the fixed capability — no prompts, env, or
 * secrets. It NEVER decides the approval it creates.
 */
export function createSessionApprovalRequester(sessions: SessionRunManager): HeartbeatApprovalRequester {
  return {
    async request(req: HeartbeatApprovalRequest): Promise<HeartbeatSessionApprovalLink | undefined> {
      const objective = `Heartbeat ${req.kind} execution approval for task ${req.taskId}`;
      const session = await sessions.createSession({
        title: 'Nova heartbeat execution approvals',
        objective,
        tags: ['heartbeat'],
      });
      const run = await sessions.startRun({
        sessionId: session.id,
        objective,
        input: `heartbeat:${req.kind}:${req.taskId}`,
      });
      const updated = await sessions.requestApproval(session.id, run.id, {
        capability: req.capability,
        action: `heartbeat:${req.kind}:execute`,
        riskLevel: 'high',
        reason: `Heartbeat-minted execution approval for task ${req.taskId} (kind=${req.kind}, capability=${req.capability}).`,
      });
      const approval = updated.approvals.at(-1);
      if (approval === undefined) return undefined;
      return { sessionApprovalId: approval.id, sessionRunId: run.id, sessionId: session.id };
    },
  };
}

/**
 * Map a session {@link ApprovalDecision} to the heartbeat resolution axis. The
 * two enums coincide today, but the explicit switch keeps the mapping total and
 * fail-closed: any unexpected value degrades to 'pending' rather than granting.
 */
export function toResolution(status: ApprovalDecision): HeartbeatApprovalResolution {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'denied':
      return 'denied';
    case 'expired':
      return 'expired';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}
