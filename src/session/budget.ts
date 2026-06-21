import type { ResponseTokenMetrics } from '../tokens/types.js';
import type { RunBudgetLimit, RunBudgetUsage } from './types.js';

export function initialBudgetUsage(): RunBudgetUsage {
  return { toolCalls: 0, durationMs: 0, exceeded: [] };
}

export function updateBudgetUsage(input: { current: RunBudgetUsage; limit: RunBudgetLimit; startedAt?: string; toolCalls?: number; tokenMetrics?: ResponseTokenMetrics }): RunBudgetUsage {
  const durationMs = input.startedAt ? Math.max(0, Date.now() - Date.parse(input.startedAt)) : input.current.durationMs;
  const usage: RunBudgetUsage = {
    ...input.current,
    durationMs,
    toolCalls: input.toolCalls ?? input.current.toolCalls,
    promptTokens: input.tokenMetrics?.promptTokens ?? input.current.promptTokens,
    completionTokens: input.tokenMetrics?.completionTokens ?? input.current.completionTokens,
    totalTokens: input.tokenMetrics?.totalTokens ?? input.current.totalTokens,
    responseTokensPerSecond: input.tokenMetrics?.responseTokensPerSecond ?? input.current.responseTokensPerSecond,
    cost: input.tokenMetrics?.cost ?? input.current.cost,
    exceeded: [],
  };
  usage.exceeded = budgetExceeded(usage, input.limit);
  return usage;
}

export function budgetExceeded(usage: RunBudgetUsage, limit: RunBudgetLimit): string[] {
  const out: string[] = [];
  if (typeof limit.maxToolCalls === 'number' && usage.toolCalls > limit.maxToolCalls) out.push('maxToolCalls');
  if (typeof limit.maxDurationMs === 'number' && usage.durationMs > limit.maxDurationMs) out.push('maxDurationMs');
  if (typeof limit.maxInputTokens === 'number' && (usage.promptTokens ?? 0) > limit.maxInputTokens) out.push('maxInputTokens');
  if (typeof limit.maxOutputTokens === 'number' && (usage.completionTokens ?? 0) > limit.maxOutputTokens) out.push('maxOutputTokens');
  if (typeof limit.maxTotalTokens === 'number' && (usage.totalTokens ?? 0) > limit.maxTotalTokens) out.push('maxTotalTokens');
  if (typeof limit.maxEstimatedCost === 'number' && (usage.cost?.totalCost ?? 0) > limit.maxEstimatedCost) out.push('maxEstimatedCost');
  return out;
}
