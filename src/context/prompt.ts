import type { ContextBlockTrace, ContextBudgetTrace } from './types.js';

export function formatBudgetReport(budget: ContextBudgetTrace): string {
  const included = budget.blocks.filter((block) => block.included);
  const omitted = budget.blocks.filter((block) => !block.included);
  return [
    `<context_budget max_tokens="${budget.maxTokens}" used_tokens="${budget.usedTokens}" remaining_tokens="${budget.remainingTokens}">`,
    'Included blocks and token-cost justification:',
    ...included.map((block) => `- ${block.id}: ~${block.estimatedTokens} tokens — ${block.reason}`),
    omitted.length ? 'Omitted blocks:' : 'Omitted blocks: none',
    ...omitted.map((block) => `- ${block.id}: ${block.omittedReason ?? 'not_applicable'} — ${block.reason}`),
    budget.suggestions?.length ? 'Capability suggestions:' : 'Capability suggestions: none',
    ...(budget.suggestions ?? []).map((item) => `- ${item.kind}:${item.name} score=${item.score.toFixed(2)} injected=${item.injected} matched=${item.matched.join(',') || 'none'} — ${item.reason}`),
    Object.keys(budget.omitted).length ? `Retrieval omissions: ${JSON.stringify(budget.omitted)}` : 'Retrieval omissions: none',
    '</context_budget>',
  ].join('\n');
}

export function joinPromptBlocks(baseSystemPrompt: string, blocks: Array<ContextBlockTrace & { content: string }>, budgetReport?: string): string {
  const dynamic = blocks.filter((block) => block.included && block.content.trim()).map((block) => block.content.trim());
  return [baseSystemPrompt.trim(), '', '## Dynamic Context Builder Output', ...dynamic, budgetReport?.trim()].filter(Boolean).join('\n\n');
}
