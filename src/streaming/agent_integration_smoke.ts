#!/usr/bin/env node
import assert from 'node:assert/strict';

import { NovaAgent } from '../agent.js';
import type { AgentConfig } from '../types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { StreamingEvent } from './types.js';

async function main(): Promise<void> {
  const config: AgentConfig = {
    llm: {
      provider: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'synthetic-test-key',
      model: 'mock-streaming-model',
      pricing: { currency: 'USD', inputCostPer1MTokens: 1, outputCostPer1MTokens: 2, source: 'test' },
    },
    systemPrompt: 'You are a concise test agent.',
    maxSteps: 2,
    trace: { enabled: false },
    context: { enabled: false },
    memory: { enabled: false },
    session: { enabled: false },
    policy: { enabled: true, profileId: 'readonly' },
  };

  const agent = new NovaAgent(config, new ToolRegistry());
  const events: StreamingEvent[] = [];

  (agent as unknown as {
    runStreaming: (input: {
      responseStartedAt: number;
      estimatedPromptTokens: number;
      emit: (event: StreamingEvent) => Promise<void>;
    }) => Promise<{ text: PromiseLike<string>; totalUsage: PromiseLike<unknown> }>;
  }).runStreaming = async (input) => {
    await input.emit({
      type: 'token',
      timestamp: new Date().toISOString(),
      text: 'streamed final answer',
      completionTokens: 5,
      elapsedMs: Date.now() - input.responseStartedAt,
    });
    return {
      text: Promise.resolve('streamed final answer'),
      totalUsage: Promise.resolve({ inputTokens: input.estimatedPromptTokens, outputTokens: 5, totalTokens: input.estimatedPromptTokens + 5 }),
    };
  };

  const steps = await agent.run('Say hello in streaming mode', { streaming: true, onEvent: (event) => { events.push(event); } });

  assert.equal(steps.at(-1)?.type, 'answer', 'agent still returns StepDisplay answer');
  assert.equal(steps.at(-1)?.content, 'streamed final answer', 'streamed text becomes final answer');
  assert.ok(events.some((event) => event.type === 'start'), 'start event emitted by NovaAgent.run');
  assert.ok(events.some((event) => event.type === 'token'), 'stream token event emitted through runStreaming');
  const finish = events.find((event): event is Extract<StreamingEvent, { type: 'finish' }> => event.type === 'finish');
  assert.ok(finish, 'finish event emitted by NovaAgent.run');
  assert.equal(finish.text, 'streamed final answer', 'finish event carries final answer');
  assert.equal(finish.metrics.completionTokens, 5, 'finish metrics use provider usage when available');
  assert.equal(finish.toolCallCount, 0, 'no phantom tool calls added');

  console.log('streaming:agent-integration-smoke passed');
}

main().catch((err) => {
  console.error('streaming:agent-integration-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
