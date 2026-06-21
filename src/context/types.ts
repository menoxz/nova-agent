import type { NovaTool } from '../types.js';
import type { MemoryRetrievalResult, MemoryTraceSummary } from '../memory/types.js';

export type ContextTrustLevel = 'trusted_system' | 'user_editable' | 'session_metadata' | 'untrusted_retrieved' | 'capability_metadata' | 'budget_metadata';

export interface ContextSkillDescriptor {
  name: string;
  description: string;
  tags?: string[];
  triggers?: string[];
  priority?: number;
}

export interface ContextMcpServerDescriptor {
  name: string;
  status: 'connected' | 'available' | 'disabled' | 'failed';
  description?: string;
  tools?: string[];
  triggers?: string[];
  priority?: number;
}

export interface ContextBuilderConfig {
  enabled?: boolean;
  /** Token budget for all dynamic context added after the stable system prompt. */
  tokenBudget?: number;
  /** Budget slice for user/org editable memory. */
  userOrgTokenBudget?: number;
  /** Budget slice for project/runtime memory. */
  memoryTokenBudget?: number;
  /** Budget slice for compact capability metadata. */
  capabilityTokenBudget?: number;
  includeBudgetReport?: boolean;
  includeUserOrgMemory?: boolean;
  includeProjectMemory?: boolean;
  includeConversationSummary?: boolean;
  includeCapabilities?: boolean;
  skills?: ContextSkillDescriptor[];
  mcpServers?: ContextMcpServerDescriptor[];
  suggestionThreshold?: number;
  maxSkillSuggestions?: number;
  maxMcpSuggestions?: number;
}

export interface ContextBlockTrace {
  id: string;
  title: string;
  trust: ContextTrustLevel;
  estimatedTokens: number;
  originalEstimatedTokens?: number;
  included: boolean;
  reason: string;
  omittedReason?: string;
  compacted?: boolean;
  compactedReason?: string;
}

export interface ContextSuggestionTrace {
  kind: 'skill' | 'mcp';
  name: string;
  score: number;
  injected: boolean;
  reason: string;
  matched: string[];
}

export interface ContextBudgetTrace {
  maxTokens: number;
  usedTokens: number;
  remainingTokens: number;
  blocks: ContextBlockTrace[];
  omitted: Record<string, number>;
  suggestions?: ContextSuggestionTrace[];
}

export interface ContextBuildResult {
  systemPrompt: string;
  budget: ContextBudgetTrace;
  memorySummary: MemoryTraceSummary;
  retrievals: {
    userOrg?: MemoryRetrievalResult;
    project?: MemoryRetrievalResult;
  };
}

export interface AgentContextBuildInput {
  input: string;
  baseSystemPrompt: string;
  config: import('../types.js').AgentConfig;
  tools: NovaTool[];
}
