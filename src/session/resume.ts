import { initialBudgetUsage } from './budget.js';
import { createMinimalRunPlan } from './planner.js';
import { newRunId, SessionStore } from './store.js';
import { CurrentSessionStore } from './current.js';
import { SESSION_SCHEMA_VERSION, type RunRecord, type RunResumeMetadata, type SessionRuntimeConfig } from './types.js';

export interface ResumeRunInput {
  sessionId: string;
  runId: string;
  reason?: string;
  createdBy?: 'local-cli' | 'runtime';
}

export class RunResumeManager {
  public readonly store: SessionStore;
  private readonly config: SessionRuntimeConfig;

  constructor(config: SessionRuntimeConfig = {}) {
    this.config = config;
    this.store = new SessionStore(config);
  }

  async resume(input: ResumeRunInput): Promise<RunRecord> {
    const source = await this.store.getRun(input.sessionId, input.runId);
    if (!source) throw new Error(`Unknown run: ${input.sessionId}/${input.runId}`);
    if (!canResumeRun(source)) throw new Error(`Run cannot be resumed from status: ${source.status}`);

    const session = await this.store.getSession(source.sessionId);
    if (!session) throw new Error(`Unknown session: ${source.sessionId}`);

    const now = new Date().toISOString();
    const resumeMetadata = createResumeMetadata(source, now, input.createdBy ?? 'local-cli', input.reason);
    const childInput = buildResumeInputPreview(source, resumeMetadata);
    const child: RunRecord = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      id: newRunId(),
      sessionId: source.sessionId,
      status: 'planned',
      objective: `Resume: ${source.objective}`.slice(0, 1_000),
      inputPreview: childInput,
      createdAt: now,
      updatedAt: now,
      plan: createMinimalRunPlan(childInput),
      budget: { limit: source.budget.limit, usage: initialBudgetUsage() },
      approvals: [],
      observability: { ...source.observability },
      events: [
        event('created', `Resume child run created from ${source.id}`, { sourceRunId: source.id, mode: 'child_run' }),
        event('planned', 'Resume run plan created from safe metadata'),
        event('resumed', 'Run resumed without auto-executing approved actions', { sourceRunId: source.id, approvedApprovalIds: resumeMetadata.approvedApprovalIds }),
      ],
      relationships: { parentRunId: source.id, resumedFromRunId: source.id },
      resume: resumeMetadata,
    };

    source.relationships = { ...source.relationships, childRunIds: [...new Set([...(source.relationships?.childRunIds ?? []), child.id])] };
    source.events.push(event('resumed', `Resume child run created: ${child.id}`, { childRunId: child.id }));
    source.updatedAt = now;

    session.activeRunId = child.id;
    session.status = 'active';
    session.updatedAt = now;
    session.runIds = [...new Set([...session.runIds, child.id])];

    await this.store.saveRun(source);
    await this.store.saveSession(session);
    await this.store.saveRun(child);
    await new CurrentSessionStore(this.config).set({ sessionId: child.sessionId, runId: child.id, source: 'resume', validate: false }).catch(() => undefined);
    return child;
  }
}

export function canResumeRun(run: RunRecord): boolean {
  return ['planned', 'waiting_approval', 'failed', 'cancelled'].includes(run.status);
}

function createResumeMetadata(source: RunRecord, createdAt: string, createdBy: 'local-cli' | 'runtime', reason?: string): RunResumeMetadata {
  return {
    sourceRunId: source.id,
    createdAt,
    createdBy,
    mode: 'child_run',
    reason: reason?.slice(0, 1_000),
    approvedApprovalIds: source.approvals.filter((approval) => approval.status === 'approved').map((approval) => approval.id),
    deniedApprovalIds: source.approvals.filter((approval) => approval.status === 'denied').map((approval) => approval.id),
    pendingApprovalIds: source.approvals.filter((approval) => approval.status === 'pending').map((approval) => approval.id),
    safety: {
      autoExecuteApprovedActions: false,
      rawToolInputsIncluded: false,
      llmInvoked: false,
    },
  };
}

function buildResumeInputPreview(source: RunRecord, resume: RunResumeMetadata): string {
  const approvalSummary = source.approvals.map((approval) => `${approval.id}:${approval.status}:${approval.capability}:${approval.action}`).join('; ') || 'none';
  return [
    `Resume source run: ${source.id}`,
    `Source status: ${source.status}`,
    `Objective: ${source.objective}`,
    `Reason: ${resume.reason ?? 'not provided'}`,
    `Approvals metadata: ${approvalSummary}`,
    'Safety: do not auto-execute approved actions; re-plan from metadata only.',
  ].join('\n').slice(0, 1_000);
}

function event(type: RunRecord['events'][number]['type'], message: string, safeMetadata?: Record<string, unknown>): RunRecord['events'][number] {
  return { id: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, type, message: message.slice(0, 1_000), timestamp: new Date().toISOString(), safeMetadata };
}
