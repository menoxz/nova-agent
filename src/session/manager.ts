import { createMinimalRunPlan } from './planner.js';
import { createRunFinalReport } from './report.js';
import { newRunId, newSessionId, SessionStore } from './store.js';
import { initialBudgetUsage, updateBudgetUsage } from './budget.js';
import { SESSION_SCHEMA_VERSION, type ApprovalRequestRecord, type FinishRunInput, type RunEventRecord, type RunRecord, type SessionRecord, type SessionRuntimeConfig, type StartRunInput } from './types.js';

export class SessionRunManager {
  public readonly store: SessionStore;
  private readonly config: SessionRuntimeConfig;

  constructor(config: SessionRuntimeConfig = {}) {
    this.config = config;
    this.store = new SessionStore(config);
  }

  async getOrCreateSession(input: { title: string; objective?: string; userId?: string; profileId?: string; projectId?: string; tags?: string[] } = { title: 'Nova session' }): Promise<SessionRecord> {
    if (this.config.defaultSessionId) {
      const existing = await this.store.getSession(this.config.defaultSessionId);
      if (existing && existing.status !== 'archived' && existing.status !== 'closed') return existing;
    }
    return this.createSession({
      title: this.config.title ?? input.title,
      objective: input.objective,
      userId: this.config.userId ?? input.userId,
      profileId: input.profileId,
      projectId: this.config.projectId ?? input.projectId,
      tags: [...new Set([...(this.config.tags ?? []), ...(input.tags ?? [])])],
    });
  }

  async createSession(input: { title: string; objective?: string; userId?: string; profileId?: string; projectId?: string; tags?: string[] }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: newSessionId(),
      title: input.title.slice(0, 160),
      objective: input.objective?.slice(0, 1_000),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      runIds: [],
      metadata: { userId: input.userId, profileId: input.profileId, projectId: input.projectId, tags: input.tags ?? [] },
    };
    await this.store.saveSession(session);
    return session;
  }

  async startRun(input: StartRunInput): Promise<RunRecord> {
    const session = await this.store.getSession(input.sessionId);
    if (!session) throw new Error(`Unknown session: ${input.sessionId}`);
    const now = new Date().toISOString();
    const run: RunRecord = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: newRunId(),
      sessionId: session.id,
      status: 'running',
      objective: input.objective.slice(0, 1_000),
      inputPreview: input.input.slice(0, 1_000),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      plan: createMinimalRunPlan(input.input),
      budget: { limit: input.budget ?? {}, usage: initialBudgetUsage() },
      approvals: [],
      observability: input.observability ?? {},
      events: [event('created', 'Run created'), event('planned', 'Minimal run plan created'), event('started', 'Run started')],
    };
    session.activeRunId = run.id;
    session.status = 'active';
    session.updatedAt = now;
    session.runIds = [...new Set([...session.runIds, run.id])];
    await this.store.saveSession(session);
    await this.store.saveRun(run);
    return run;
  }

  async recordEvent(sessionId: string, runId: string, type: RunEventRecord['type'], message: string, safeMetadata?: Record<string, unknown>): Promise<RunRecord> {
    const run = await this.requireRun(sessionId, runId);
    run.events.push(event(type, message, safeMetadata));
    run.updatedAt = new Date().toISOString();
    await this.store.saveRun(run);
    return run;
  }

  async requestApproval(sessionId: string, runId: string, approval: Omit<ApprovalRequestRecord, 'id' | 'status' | 'requestedAt'>): Promise<RunRecord> {
    const run = await this.requireRun(sessionId, runId);
    const record: ApprovalRequestRecord = { ...approval, id: `approval_${run.approvals.length + 1}`, status: 'pending', requestedAt: new Date().toISOString() };
    run.approvals.push(record);
    run.status = 'waiting_approval';
    run.events.push(event('approval_requested', `Approval requested: ${approval.action}`, { capability: approval.capability, riskLevel: approval.riskLevel }));
    run.updatedAt = new Date().toISOString();
    await this.store.saveRun(run);
    return run;
  }

  async decideApproval(sessionId: string, runId: string, approvalId: string, decision: 'approved' | 'denied', input: { decidedBy?: string; reason?: string } = {}): Promise<RunRecord> {
    const run = await this.requireRun(sessionId, runId);
    const approval = run.approvals.find((item) => item.id === approvalId);
    if (!approval) throw new Error(`Unknown approval: ${approvalId}`);
    if (approval.status !== 'pending') throw new Error(`Approval is not pending: ${approvalId}`);
    approval.status = decision;
    approval.decidedAt = new Date().toISOString();
    approval.decidedBy = input.decidedBy ?? 'local-cli';
    approval.decisionReason = input.reason?.slice(0, 1_000);
    run.status = decision === 'denied' ? 'failed' : run.status === 'waiting_approval' ? 'planned' : run.status;
    run.events.push(event('approval_decided', `Approval ${decision}: ${approvalId}`, { approvalId, decision }));
    run.updatedAt = new Date().toISOString();
    await this.store.saveRun(run);
    return run;
  }

  async finishRun(sessionId: string, runId: string, input: FinishRunInput): Promise<RunRecord> {
    const run = await this.requireRun(sessionId, runId);
    run.status = input.status;
    run.endedAt = new Date().toISOString();
    run.updatedAt = run.endedAt;
    run.observability = { ...run.observability, ...input.observability };
    run.budget.usage = updateBudgetUsage({ current: run.budget.usage, limit: run.budget.limit, startedAt: run.startedAt, tokenMetrics: input.tokenMetrics, toolCalls: input.toolCalls });
    run.finalReport = createRunFinalReport(run, input.status, input.summary);
    run.events.push(event('finished', `Run finished with status ${input.status}`, { budgetExceeded: run.budget.usage.exceeded }));
    const session = await this.store.getSession(sessionId);
    if (session) {
      session.activeRunId = session.activeRunId === run.id ? undefined : session.activeRunId;
      session.status = 'idle';
      session.updatedAt = run.updatedAt;
      await this.store.saveSession(session);
    }
    await this.store.saveRun(run);
    return run;
  }

  private async requireRun(sessionId: string, runId: string): Promise<RunRecord> {
    const run = await this.store.getRun(sessionId, runId);
    if (!run) throw new Error(`Unknown run: ${sessionId}/${runId}`);
    return run;
  }
}

function event(type: RunEventRecord['type'], message: string, safeMetadata?: Record<string, unknown>): RunEventRecord {
  return { id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, type, message: message.slice(0, 1_000), timestamp: new Date().toISOString(), safeMetadata };
}
