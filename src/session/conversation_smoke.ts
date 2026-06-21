#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { NovaAgent } from '../agent.js';
import { buildAgentContext } from '../context/index.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig, NovaTool } from '../types.js';
import { ConversationStore } from './conversation.js';
import { SessionRunManager } from './manager.js';

const noopTool: NovaTool = { name: 'noop', description: 'No-op read-only tool for conversation smoke.', inputSchema: z.object({}), readOnly: true, execute: async () => 'ok' };

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-conversation-smoke-'));
  try {
    const sessionConfig = { projectRoot: root, enabled: true, conversation: { keepRecentTurns: 2, maxPreviewChars: 160, summaryMaxChars: 1_500 } };
    const manager = new SessionRunManager(sessionConfig);
    const session = await manager.createSession({ title: 'Conversation smoke', objective: 'Validate conversation persistence' });
    const run = await manager.startRun({ sessionId: session.id, objective: 'Need safe continuity', input: 'Remember this decision without storing apiKey=sk-12345678901234567890' });
    await manager.requestApproval(session.id, run.id, { capability: 'write', action: 'tool:write_file', riskLevel: 'medium', reason: 'write approval for smoke' });
    await manager.decideApproval(session.id, run.id, 'approval_1', 'approved', { reason: 'safe smoke approval' });
    const finished = await manager.finishRun(session.id, run.id, { status: 'succeeded', summary: 'Decision: use metadata-only conversation persistence. Next step: run typecheck.', toolCalls: 0 });

    const store = new ConversationStore(sessionConfig);
    const conversation = await store.addTurn({ sessionId: session.id, run: finished, userInput: 'Please persist this but redact token=sk-12345678901234567890', assistantText: 'Decision: use metadata-only conversation persistence. Next step: run typecheck.' });
    assert.equal(conversation.turns.length, 1, 'turn persisted');
    assert.equal(conversation.safety.rawPromptsIncluded, false, 'raw prompts are not stored by contract');
    assert.equal(conversation.safety.rawToolInputsIncluded, false, 'raw tool inputs are not stored');
    assert.match(conversation.turns[0]?.userPreview ?? '', /\[REDACTED\]/, 'secret-like token redacted');
    assert.ok(conversation.summary.text.includes('conversation_summary'), 'deterministic summary created');
    assert.deepEqual(conversation.summary.safety, { deterministic: true, llmInvoked: false, metadataOnly: true, rawPromptsIncluded: false, rawToolInputsIncluded: false, secretsIncluded: false }, 'summary safety flags set');

    await store.addTurn({ sessionId: session.id, userInput: 'Second turn', assistantText: 'Blocker: waiting on approval. Next step: resume run.' });
    await store.addTurn({ sessionId: session.id, userInput: 'Third turn', assistantText: 'Decision: keep only recent turns during compaction.' });
    const compacted = await store.compact(session.id);
    assert.equal(compacted.turns.length, 2, 'compaction keeps bounded recent turns');
    assert.ok(compacted.summary.compactedAt, 'compaction timestamp recorded');
    assert.ok(compacted.summary.decisions.some((item) => /metadata-only|recent turns/.test(item)), 'decisions summarized deterministically');

    const tools = new ToolRegistry();
    tools.register(noopTool);
    const config: AgentConfig = {
      llm: { provider: 'mock', baseUrl: 'http://localhost', apiKey: 'test', model: 'mock' },
      systemPrompt: 'You are Nova.',
      maxSteps: 1,
      trace: { enabled: false },
      session: { ...sessionConfig, defaultSessionId: session.id, title: 'Conversation integrated session' },
      context: { enabled: true, tokenBudget: 800, includeUserOrgMemory: false, includeProjectMemory: false, includeCapabilities: false, includeConversationSummary: true },
    };
    const context = await buildAgentContext({ input: 'Continue from conversation', baseSystemPrompt: 'Base', config, tools: tools.list() });
    assert.ok(context.systemPrompt.includes('conversation_summary'), 'context injects session conversation summary');

    const before = (await store.get(session.id))?.turns.length ?? 0;
    await new NovaAgent(config, tools).run('Answer briefly and preserve continuity');
    const after = await store.get(session.id);
    assert.ok((after?.turns.length ?? 0) > before, 'NovaAgent appends a safe conversation turn');

    console.log('conversation:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('conversation:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
