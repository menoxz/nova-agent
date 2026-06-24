import { SessionRunManager } from '../session/manager.js';
import type { SessionRuntimeConfig } from '../session/types.js';

export interface HeartbeatDecisionLocator {
  readonly sessionId: string;
  readonly runId: string;
  readonly approvalId: string;
}

export interface HeartbeatDecisionRequest {
  readonly locator: HeartbeatDecisionLocator;
  readonly decision: 'approved' | 'denied';
  readonly reason?: string;
}

export type HeartbeatDecisionOutcome =
  | { readonly ok: true; readonly status: 'approved' | 'denied' }
  | { readonly ok: false; readonly error: 'unknown_run' | 'unknown_approval' | 'not_pending' | 'io_error' };

export interface HeartbeatDecisionApplier {
  apply(req: HeartbeatDecisionRequest): Promise<HeartbeatDecisionOutcome>;
}

export function mapHeartbeatDecisionError(err: unknown): HeartbeatDecisionOutcome {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('Unknown run: ')) return { ok: false, error: 'unknown_run' };
  if (message.startsWith('Unknown approval: ')) return { ok: false, error: 'unknown_approval' };
  if (message.startsWith('Approval is not pending: ')) return { ok: false, error: 'not_pending' };
  return { ok: false, error: 'io_error' };
}

export function createHeartbeatDecisionApplier(deps: { projectRoot: string }): HeartbeatDecisionApplier {
  const config: SessionRuntimeConfig = { projectRoot: deps.projectRoot };
  return {
    async apply(req: HeartbeatDecisionRequest): Promise<HeartbeatDecisionOutcome> {
      const sessions = new SessionRunManager(config);
      try {
        await sessions.decideApproval(req.locator.sessionId, req.locator.runId, req.locator.approvalId, req.decision, {
          decidedBy: 'heartbeat-operator',
          reason: req.reason,
        });
        return { ok: true, status: req.decision };
      } catch (err) {
        return mapHeartbeatDecisionError(err);
      }
    },
  };
}
