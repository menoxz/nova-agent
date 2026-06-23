#!/usr/bin/env node
/**
 * Nova Agent — Offline ReAct seam smoke
 *
 * Proves the NovaAgent model-injection seam: when a LanguageModel is injected,
 * createModel() is bypassed and the full ReAct loop
 *   reasoning -> tool_call -> tool_result -> answer
 * runs entirely offline against a MockLanguageModelV3 (from the installed `ai`
 * package's `ai/test` entrypoint — no new dependency).
 *
 * Offline guarantees:
 * - The injected mock means no provider client is constructed and the
 *   (deliberately invalid) baseUrl is never dialed.
 * - No secrets are read (no .env / process.env credentials touched).
 */
import assert from 'node:assert/strict';
import { z } from 'zod';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3, LanguageModelV3GenerateResult } from '@ai-sdk/provider';

import { NovaAgent } from './agent.js';
import { ToolRegistry } from './tools/registry.js';
import type { AgentConfig, NovaTool } from './types.js';

const REASONING_SENTINEL = 'Planning: inspect the fixture before answering.';
const TOOL_SENTINEL = 'FIXTURE_OBSERVED';
const ANSWER_SENTINEL = 'NOVA_REACT_OK';

function usage(input: number, output: number): LanguageModelV3GenerateResult['usage'] {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

async function main(): Promise<void> {
  // Stateful mock: call 1 -> reasoning + tool-call; call 2 -> final answer.
  let call = 0;
  const doGenerate: LanguageModelV3['doGenerate'] = async () => {
    call += 1;
    if (call === 1) {
      return {
        content: [
          { type: 'text', text: REASONING_SENTINEL },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'inspect_fixture',
            input: JSON.stringify({ path: 'fixtures/alpha.txt' }),
          },
        ],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: usage(42, 8),
        warnings: [],
      };
    }
    return {
      content: [{ type: 'text', text: ANSWER_SENTINEL }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: usage(50, 4),
      warnings: [],
    };
  };

  const mock = new MockLanguageModelV3({ provider: 'mock', modelId: 'mock-react', doGenerate });

  // Real registry + a hermetic, read-only tool (no filesystem or network touch).
  const registry = new ToolRegistry();
  const inspectFixture: NovaTool = {
    name: 'inspect_fixture',
    description: 'Return a fixed observation about an in-memory fixture (offline, read-only).',
    inputSchema: z.object({ path: z.string() }),
    capability: 'read',
    readOnly: true,
    riskLevel: 'low',
    execute: async (input: { path: string }) => `${TOOL_SENTINEL} path=${input.path}`,
  };
  registry.register(inspectFixture);

  const config: AgentConfig = {
    llm: {
      provider: 'openmodel',
      // Deliberately invalid: if the seam leaked to createModel, dialing this would throw.
      baseUrl: 'https://offline.invalid/v1',
      apiKey: 'synthetic-offline-key',
      model: 'mock-react',
    },
    systemPrompt: 'You are an offline ReAct test agent.',
    maxSteps: 4,
    trace: { enabled: false },
    context: { enabled: false },
    memory: { enabled: false },
    session: { enabled: false },
    // Policy disabled to isolate the seam + ReAct loop from policy evaluation.
    policy: { enabled: false },
  };

  const agent = new NovaAgent(config, registry, mock);
  const steps = await agent.run('Inspect the fixture, then confirm.');

  // The injected mock was used (createModel bypassed -> fully offline).
  assert.equal(mock.doGenerateCalls.length, 2, 'injected mock drove exactly two generations');

  const reasoning = steps.find((s) => s.type === 'reasoning');
  assert.ok(reasoning?.content.includes('inspect the fixture'), 'reasoning step captured');

  const toolCall = steps.find((s) => s.type === 'tool_call');
  assert.equal(toolCall?.toolName, 'inspect_fixture', 'tool_call step targets inspect_fixture');

  const toolResult = steps.find((s) => s.type === 'tool_result');
  assert.ok(toolResult?.content.includes(TOOL_SENTINEL), 'tool_result step carries tool output');

  const answer = steps.at(-1);
  assert.equal(answer?.type, 'answer', 'final step is the answer');
  assert.ok(answer?.content.includes(ANSWER_SENTINEL), 'final answer carries model text');

  // ReAct ordering: reasoning -> tool_call -> tool_result -> answer
  const order = steps.map((s) => s.type);
  assert.deepEqual(order, ['reasoning', 'tool_call', 'tool_result', 'answer'], 'ReAct step order preserved');

  console.log('agent:smoke (offline ReAct seam) passed');
}

main().catch((err) => {
  console.error('agent:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
