import type { BudgetState, SubagentBudget } from './types.js';

export const DEFAULT_SUBAGENT_BUDGET: SubagentBudget = {
  maxToolCalls: 8,
  maxDurationMs: 60_000,
  maxOutputChars: 12_000,
};

export function createBudgetState(overrides: Partial<SubagentBudget> = {}): BudgetState {
  return { ...DEFAULT_SUBAGENT_BUDGET, ...overrides, toolCalls: 0, startedAt: Date.now(), outputChars: 0 };
}

export function assertBudgetAvailable(budget: BudgetState): void {
  if (budget.toolCalls >= budget.maxToolCalls) throw new Error('Sub-agent budget exhausted: max tool calls reached');
  if (Date.now() - budget.startedAt > budget.maxDurationMs) throw new Error('Sub-agent budget exhausted: max duration reached');
  if (budget.outputChars >= budget.maxOutputChars) throw new Error('Sub-agent budget exhausted: max output chars reached');
}

export function recordBudgetUsage(budget: BudgetState, output: unknown): void {
  budget.toolCalls += 1;
  budget.outputChars += typeof output === 'string' ? output.length : JSON.stringify(output).length;
}

export function budgetExhausted(budget: BudgetState): boolean {
  return budget.toolCalls >= budget.maxToolCalls || Date.now() - budget.startedAt > budget.maxDurationMs || budget.outputChars >= budget.maxOutputChars;
}
