#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { SessionRunManager } from './manager.js';
import { NovaAgent } from '../agent.js';
import { ToolRegistry } from '../tools/registry.js';
import type { NovaTool } from '../types.js';

const noopTool: NovaTool = { name: 'noop', description: 'No-op read-only tool for session smoke.', inputSchema: z.object({}), readOnly: true, execute: async () => 'ok' };

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-session-smoke-'));
  try {
    const manager = new SessionRunManager({ projectRoot: root, enabled: true });
    const session = await manager.createSession({ title: 'Session smoke', objective: 'Validate session/run manager', profileId: 'nova.builder', tags: ['smoke'] });
    assert.match(session.id, /^ses_/, 'session id generated');

    const run = await manager.startRun({ sessionId: session.id, objective: 'Implement feature safely', input: 'Implement a TypeScript feature and verify it with smoke tests', budget: { maxToolCalls: 3, maxTotalTokens: 20, maxEstimatedCost: 0.00001, currency: 'USD' }, observability: { traceRunId: 'trace-smoke' } });
    assert.equal(run.status, 'running', 'run starts running');
    assert.equal(run.plan.strategy, 'standard', 'complex task gets standard plan');

    const waiting = await manager.requestApproval(session.id, run.id, { capability: 'write', action: 'tool:write_file', riskLevel: 'medium', reason: 'smoke approval request' });
    assert.equal(waiting.status, 'waiting_approval', 'approval changes run status');
    assert.equal(waiting.approvals.length, 1, 'approval persisted');

    await manager.recordEvent(session.id, run.id, 'context_built', 'Context budget attached', { usedTokens: 123 });
    const finished = await manager.finishRun(session.id, run.id, { status: 'succeeded', summary: 'Smoke run finished.', toolCalls: 4, tokenMetrics: { promptTokens: 15, completionTokens: 10, totalTokens: 25, source: 'estimated', responseDurationMs: 1000, responseTokensPerSecond: 10, cost: { currency: 'USD', inputCost: 0.00001, outputCost: 0.00001, totalCost: 0.00002, pricingUnit: 'per_1m_tokens', pricingSource: 'smoke', estimated: true } } });
    assert.equal(finished.status, 'succeeded', 'run finishes');
    assert.ok(finished.finalReport, 'final report created');
    assert.deepEqual(finished.budget.usage.exceeded.sort(), ['maxEstimatedCost', 'maxToolCalls', 'maxTotalTokens'].sort(), 'budget exceedances detected');

    const index = await manager.store.readIndex();
    assert.equal(index.sessions.length, 1, 'session indexed');
    assert.equal(index.runs.length, 1, 'run indexed');
    assert.equal((await manager.store.getSession(session.id))?.status, 'idle', 'session returns to idle');

    const agentTools = new ToolRegistry();
    agentTools.register(noopTool);
    const agent = new NovaAgent({
      llm: { provider: 'mock', baseUrl: 'http://localhost', apiKey: 'test', model: 'mock' },
      systemPrompt: 'You are Nova.',
      maxSteps: 1,
      trace: { enabled: false },
      session: { enabled: true, projectRoot: root, title: 'Agent integrated session', defaultBudget: { maxToolCalls: 5, currency: 'USD' } },
      context: { enabled: true, tokenBudget: 300, includeUserOrgMemory: false, includeProjectMemory: false, includeCapabilities: true },
    }, agentTools);
    await agent.run('Answer briefly without tools');
    const integratedIndex = await manager.store.rebuildIndex();
    assert.ok(integratedIndex.sessions.length >= 2, 'agent integration creates a session');
    assert.ok(integratedIndex.runs.length >= 2, 'agent integration creates and finishes a run');

    console.log('session:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('session:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
