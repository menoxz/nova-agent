import { compactTextToTokenBudget, estimateTokens } from '../tokens/index.js';
import type { ContextBlockTrace } from './types.js';

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 1_800;
export const DEFAULT_USER_ORG_TOKEN_BUDGET = 350;
export const DEFAULT_MEMORY_TOKEN_BUDGET = 700;
export const DEFAULT_CAPABILITY_TOKEN_BUDGET = 450;

export function packContextBlocks(blocks: Array<ContextBlockTrace & { content: string }>, maxTokens: number): Array<ContextBlockTrace & { content: string }> {
  let used = 0;
  return blocks.map((block) => {
    if (!block.included) return block;
    if (used + block.estimatedTokens > maxTokens) {
      const remaining = maxTokens - used;
      if (remaining >= 80) {
        const compacted = compactTextToTokenBudget(block.content, remaining, { reason: 'context_budget_exceeded' });
        if (compacted.compactedTokens <= remaining) {
          used += compacted.compactedTokens;
          return {
            ...block,
            content: compacted.text,
            estimatedTokens: compacted.compactedTokens,
            originalEstimatedTokens: compacted.originalTokens,
            compacted: true,
            compactedReason: compacted.reason,
            omittedReason: `compacted_${compacted.omittedLines}_lines`,
          };
        }
      }
      return { ...block, included: false, omittedReason: 'context_budget_exceeded', originalEstimatedTokens: block.estimatedTokens };
    }
    used += block.estimatedTokens;
    return block;
  });
}

export { estimateTokens };
