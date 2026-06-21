import type { RunFinalReport, RunRecord, RunStatus } from './types.js';

export function createRunFinalReport(run: RunRecord, status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>, summary: string): RunFinalReport {
  return {
    status,
    summary: summary.slice(0, 2_000),
    completedSteps: run.plan.steps.filter((step) => step.status === 'done').length,
    blockedSteps: run.plan.steps.filter((step) => step.status === 'blocked').length,
    approvalCount: run.approvals.length,
    budgetExceeded: [...run.budget.usage.exceeded],
    metrics: run.budget.usage,
    endedAt: new Date().toISOString(),
  };
}
