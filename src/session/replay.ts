import type { RunRecord, RunReplaySummary, SessionRuntimeConfig } from './types.js';
import { SessionStore } from './store.js';

export class RunReplayManager {
  public readonly store: SessionStore;

  constructor(config: SessionRuntimeConfig = {}) {
    this.store = new SessionStore(config);
  }

  async replay(sessionId: string, runId: string): Promise<RunReplaySummary> {
    const run = await this.store.getRun(sessionId, runId);
    if (!run) throw new Error(`Unknown run: ${sessionId}/${runId}`);
    return createRunReplaySummary(run);
  }

  async report(sessionId: string, runId: string): Promise<RunReplaySummary> {
    return this.replay(sessionId, runId);
  }
}

export function createRunReplaySummary(run: RunRecord): RunReplaySummary {
  return {
    schemaVersion: run.schemaVersion,
    sessionId: run.sessionId,
    runId: run.id,
    status: run.status,
    objective: run.objective,
    inputPreview: run.inputPreview,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    plan: run.plan,
    budget: run.budget,
    approvals: run.approvals,
    observability: run.observability,
    events: run.events,
    finalReport: run.finalReport,
    relationships: run.relationships,
    resume: run.resume,
    safety: {
      metadataOnly: true,
      llmInvoked: false,
      toolsInvoked: false,
      rawToolInputsIncluded: false,
      secretsIncluded: false,
    },
  };
}
