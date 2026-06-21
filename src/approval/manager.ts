import { SessionStore } from '../session/store.js';
import type { ApprovalRequestRecord, RunRecord, SessionRuntimeConfig } from '../session/types.js';
import type { ApprovalDecisionInput, ApprovalListItem } from './types.js';

export class ApprovalManager {
  public readonly store: SessionStore;

  constructor(config: SessionRuntimeConfig = {}) {
    this.store = new SessionStore(config);
  }

  async list(status?: ApprovalListItem['status']): Promise<ApprovalListItem[]> {
    const runs = await this.store.listRuns();
    return runs.flatMap((run) => run.approvals.map((approval) => toListItem(run, approval)))
      .filter((item) => !status || item.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async decide(input: ApprovalDecisionInput): Promise<ApprovalListItem> {
    const runs = await this.store.listRuns();
    for (const run of runs) {
      const approval = run.approvals.find((item) => item.id === input.approvalId);
      if (!approval) continue;
      if (approval.status !== 'pending') throw new Error(`Approval is not pending: ${input.approvalId}`);
      approval.status = input.decision;
      approval.decidedAt = new Date().toISOString();
      approval.decidedBy = input.decidedBy ?? 'local-cli';
      approval.decisionReason = input.reason?.slice(0, 1_000);
      run.events.push({ id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, type: 'approval_decided', timestamp: new Date().toISOString(), message: `Approval ${input.decision}: ${input.approvalId}`, safeMetadata: { approvalId: input.approvalId, decision: input.decision } });
      run.updatedAt = new Date().toISOString();
      if (input.decision === 'denied') run.status = 'failed';
      if (input.decision === 'approved' && run.status === 'waiting_approval') run.status = 'planned';
      await this.store.saveRun(run);
      return toListItem(run, approval);
    }
    throw new Error(`Approval not found: ${input.approvalId}`);
  }
}

function toListItem(run: RunRecord, approval: ApprovalRequestRecord): ApprovalListItem {
  return {
    approvalId: approval.id,
    sessionId: run.sessionId,
    runId: run.id,
    status: approval.status,
    capability: approval.capability,
    action: approval.action,
    toolName: typeof approval.safeMetadata?.toolName === 'string' ? approval.safeMetadata.toolName : undefined,
    riskLevel: approval.riskLevel,
    reason: approval.reason,
    requestedAt: approval.requestedAt,
    decidedAt: approval.decidedAt,
    decidedBy: approval.decidedBy,
    decisionReason: approval.decisionReason,
  };
}
