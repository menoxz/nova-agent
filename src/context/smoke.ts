#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { buildAgentContext } from './builder.js';
import { upsertEditableUserOrgMemory } from '../memory/editable_store.js';
import { writeMemory } from '../memory/writer.js';
import type { AgentConfig, NovaTool } from '../types.js';

const tool = (name: string, description: string): NovaTool => ({ name, description, inputSchema: z.object({}), readOnly: true, execute: async () => 'ok' });

function config(root: string): AgentConfig {
  return {
    llm: { provider: 'mock', baseUrl: 'http://localhost', apiKey: 'test', model: 'mock' },
    systemPrompt: 'You are Nova.',
    maxSteps: 3,
    policy: { enabled: true, profileId: 'developer', approvalProvided: true, actor: { actorId: 'context-smoke', actorType: 'root_agent' } },
    memory: {
      enabled: true,
      projectRoot: root,
      approvalProvided: true,
      policyProfileId: 'developer',
      profile: {
        id: 'nova.builder', version: '1.0.0', hash: 'hash', source: 'builtin', mode: 'root', policyProfileId: 'developer',
        memory: { scope: 'workspace', readCollections: ['project_knowledge', 'architecture_decisions', 'user_profile', 'user_preferences', 'organization_profile', 'organization_stack'], writeCollections: ['project_knowledge', 'architecture_decisions', 'user_profile', 'user_preferences', 'organization_profile', 'organization_stack'], retention: { strategy: 'archive', ttlDays: 180 } },
      },
    },
    context: { enabled: true, tokenBudget: 900, userOrgTokenBudget: 180, memoryTokenBudget: 220, capabilityTokenBudget: 180, includeBudgetReport: true, suggestionThreshold: 1, skills: [{ name: 'context-builder', description: 'Build a minimal relevant agent context.', tags: ['context', 'memory'], triggers: ['context', 'budget'], priority: 0.5 }], mcpServers: [{ name: 'nova-mcp', status: 'connected', description: 'Read-only Nova MCP server.', tools: ['nova_read_file', 'nova_git_status'], triggers: ['git', 'file', 'read'] }] },
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-context-smoke-'));
  try {
    const cfg = config(root);
    await upsertEditableUserOrgMemory({ collection: 'user_preferences', key: 'language', title: 'Preferred language', summary: 'The user prefers French for product and architecture discussions.', tags: ['language', 'context'] }, cfg.memory);
    await upsertEditableUserOrgMemory({ collection: 'organization_stack', key: 'runtime', title: 'Organization runtime', summary: 'The organization standard runtime is Node.js 22 with TypeScript.', tags: ['typescript', 'node'] }, cfg.memory);
    await writeMemory({ type: 'decision', collection: 'architecture_decisions', scope: { kind: 'project', projectId: 'nova-agent' }, content: { title: 'Context Builder controls token cost', summary: 'Dynamic context must include a token budget report and justify every injected block.', tags: ['context', 'budget'] }, source: { kind: 'manual' }, quality: { confidence: 0.95, importance: 0.9 } }, cfg.memory);

    const result = await buildAgentContext({ input: 'Implement context builder with token budget for Nova TypeScript agent in French for a Node.js organization', baseSystemPrompt: cfg.systemPrompt, config: cfg, tools: [tool('read_file', 'Read project files safely.'), tool('write_file', 'Write files when policy allows.'), tool('git', 'Inspect local git status and diffs.')] });
    assert.match(result.systemPrompt, /user_organization_memory/, 'user/org editable memory is injected');
    assert.match(result.systemPrompt, /retrieved_memory_untrusted/, 'project memory is injected as untrusted');
    assert.match(result.systemPrompt, /available_capabilities/, 'capabilities are injected');
    assert.match(result.systemPrompt, /context_budget/, 'budget report is injected');
    assert.ok(result.budget.usedTokens <= result.budget.maxTokens, 'dynamic context stays within token budget');
    assert.ok(result.budget.blocks.every((block) => block.reason.length > 10), 'every block has a justification');
    assert.ok(result.budget.suggestions?.some((item) => item.kind === 'skill' && item.name === 'context-builder' && item.injected), 'relevant skill suggestion is scored and injected');
    assert.match(result.systemPrompt, /Capability suggestions/, 'budget report includes suggestion scoring');
    assert.equal(result.memorySummary.retrievedCount, 3, 'trace summary counts user/org plus project memory metadata only');

    const tight = await buildAgentContext({ input: 'context budget', baseSystemPrompt: cfg.systemPrompt, config: { ...cfg, context: { ...cfg.context, tokenBudget: 120 } }, tools: [tool('read_file', 'Read project files safely.')] });
    assert.ok(tight.budget.blocks.some((block) => block.compacted || (!block.included && block.omittedReason === 'context_budget_exceeded')), 'tight budget compacts or omits blocks with reason');
    console.log('context:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('context:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
