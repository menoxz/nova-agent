import type { RunPlan, RunPlanStep } from './types.js';

export function createMinimalRunPlan(input: string): RunPlan {
  const complex = /\b(implement|build|create|fix|debug|refactor|test|deploy|migrate|architecture|design|security|audit)\b/i.test(input);
  const now = new Date().toISOString();
  const steps: RunPlanStep[] = complex ? [
    step('understand', 'Clarify objective and constraints', 'Restate the useful objective, DoD, risks, and out-of-scope boundaries.'),
    step('inspect', 'Inspect relevant context', 'Use Context Builder, repository evidence, memory, tools, or subagents as needed.'),
    step('act', 'Execute minimal safe change', 'Act incrementally and preserve policy/approval boundaries.'),
    step('verify', 'Verify result', 'Run targeted checks, smoke tests, evals, or explain verification limits.'),
    step('report', 'Report outcome', 'Summarize changes, metrics, approvals, remaining risks, and next step.'),
  ] : [
    step('understand', 'Understand request', 'Identify the direct answer needed and constraints.'),
    step('report', 'Answer', 'Respond concisely with relevant caveats.'),
  ];
  return { strategy: complex ? 'standard' : 'minimal', createdAt: now, steps };
}

function step(kind: RunPlanStep['kind'], title: string, description: string): RunPlanStep {
  return { id: `step_${kind}`, kind, title, description, status: 'pending' };
}
