import { estimateTokens, DEFAULT_CAPABILITY_TOKEN_BUDGET, DEFAULT_CONTEXT_TOKEN_BUDGET, DEFAULT_MEMORY_TOKEN_BUDGET, DEFAULT_USER_ORG_TOKEN_BUDGET, packContextBlocks } from './budget.js';
import { selectCapabilityContext } from './selectors/capabilities.js';
import { contextMemoryConfig, formatUserOrgMemoryContext, retrieveProjectMemory, retrieveUserOrgMemory } from './selectors/memory.js';
import { formatBudgetReport, joinPromptBlocks } from './prompt.js';
import type { AgentContextBuildInput, ContextBlockTrace, ContextBuildResult } from './types.js';
import type { MemoryRetrievalResult, MemoryTraceSummary } from '../memory/types.js';
import { ConversationStore } from '../session/conversation.js';

const EMPTY_RETRIEVAL: MemoryRetrievalResult = { cards: [], contextBlock: '', omitted: {}, summary: { retrievedIds: [], retrievedCount: 0, retrievedChars: 0 } };

export async function buildAgentContext(input: AgentContextBuildInput): Promise<ContextBuildResult> {
  const cfg = input.config.context ?? {};
  if (cfg.enabled === false) {
    return { systemPrompt: input.baseSystemPrompt, budget: { maxTokens: 0, usedTokens: 0, remainingTokens: 0, blocks: [], omitted: { disabled: 1 } }, memorySummary: EMPTY_RETRIEVAL.summary, retrievals: {} };
  }

  const maxTokens = cfg.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const memoryConfig = contextMemoryConfig(input.config);
  const retrievals: ContextBuildResult['retrievals'] = {};
  const omitted: Record<string, number> = {};
  const suggestions: import('./types.js').ContextSuggestionTrace[] = [];
  let userOrg = EMPTY_RETRIEVAL;
  let project = EMPTY_RETRIEVAL;

  if (cfg.includeUserOrgMemory !== false) {
    try { userOrg = await retrieveUserOrgMemory(input.input, memoryConfig, cfg.userOrgTokenBudget ?? DEFAULT_USER_ORG_TOKEN_BUDGET); } catch { userOrg = { ...EMPTY_RETRIEVAL, omitted: { error: 1 } }; }
    retrievals.userOrg = userOrg;
    mergeCounts(omitted, prefixCounts(userOrg.omitted, 'user_org'));
  }
  if (cfg.includeProjectMemory !== false) {
    try { project = await retrieveProjectMemory(input.input, memoryConfig, cfg.memoryTokenBudget ?? DEFAULT_MEMORY_TOKEN_BUDGET); } catch { project = { ...EMPTY_RETRIEVAL, omitted: { error: 1 } }; }
    retrievals.project = project;
    mergeCounts(omitted, prefixCounts(project.omitted, 'project_memory'));
  }

  const rawBlocks: Array<ContextBlockTrace & { content: string }> = [];
  if (cfg.includeConversationSummary !== false && input.config.session?.enabled) {
    const conversationContent = await retrieveConversationSummary(input).catch(() => '');
    rawBlocks.push(block('session_conversation_summary', 'Session conversation summary', 'session_metadata', conversationContent, conversationContent.length > 0, 'safe deterministic session summary helps continuity without raw prompts or tool inputs'));
  }
  const userOrgContent = formatUserOrgMemoryContext(userOrg);
  rawBlocks.push(block('user_organization_memory', 'User/organization editable memory', 'user_editable', userOrgContent, userOrgContent.length > 0, 'user/company facts and preferences are useful only when matching memories exist'));
  rawBlocks.push(block('retrieved_project_memory', 'Retrieved project memory', 'untrusted_retrieved', project.contextBlock, project.contextBlock.length > 0, 'project decisions and procedures are injected only when retrieval finds relevant cards'));
  if (cfg.includeCapabilities !== false) {
    const capability = selectCapabilityContext(input.input, input.tools, { ...cfg, capabilityTokenBudget: cfg.capabilityTokenBudget ?? DEFAULT_CAPABILITY_TOKEN_BUDGET });
    const capabilityContent = capability.contextBlock;
    suggestions.push(...capability.suggestions);
    rawBlocks.push(block('available_capabilities', 'Available capabilities', 'capability_metadata', capabilityContent, capabilityContent.length > 0, 'compact tool/skill/MCP metadata helps the model choose actions without injecting full catalogs'));
  }

  const packed = packContextBlocks(rawBlocks, maxTokens);
  const usedTokens = packed.filter((item) => item.included).reduce((sum, item) => sum + item.estimatedTokens, 0);
  const budget = { maxTokens, usedTokens, remainingTokens: Math.max(0, maxTokens - usedTokens), blocks: packed.map(({ content: _content, ...meta }) => meta), omitted, suggestions };
  const budgetReport = cfg.includeBudgetReport === false ? undefined : formatBudgetReport(budget);
  const systemPrompt = joinPromptBlocks(input.baseSystemPrompt, packed, budgetReport);
  return { systemPrompt, budget, memorySummary: combineMemorySummary(userOrg.summary, project.summary), retrievals };
}

async function retrieveConversationSummary(input: AgentContextBuildInput): Promise<string> {
  const sessionId = input.config.session?.defaultSessionId;
  if (!sessionId) return '';
  const store = new ConversationStore(input.config.session);
  const summary = await store.summary(sessionId);
  return summary.text;
}

function block(id: string, title: string, trust: ContextBlockTrace['trust'], content: string, included: boolean, reason: string): ContextBlockTrace & { content: string } {
  return { id, title, trust, content, included, estimatedTokens: estimateTokens(content), reason, omittedReason: included ? undefined : 'empty_or_not_relevant' };
}

function combineMemorySummary(...summaries: MemoryTraceSummary[]): MemoryTraceSummary {
  const ids = summaries.flatMap((summary) => summary.retrievedIds);
  return { retrievedIds: ids, retrievedCount: ids.length, retrievedChars: summaries.reduce((sum, summary) => sum + summary.retrievedChars, 0) };
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

function prefixCounts(counts: Record<string, number>, prefix: string): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${prefix}.${key}`, value]));
}
