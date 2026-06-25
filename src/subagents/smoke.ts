#!/usr/bin/env node

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig, NovaTool } from '../types.js';
import { createBudgetState, assertBudgetAvailable, recordBudgetUsage } from './budget.js';
import { buildScopedContext } from './context.js';
import { assertProducerCannotSelfVerify } from './contracts.js';
import { deriveEffectiveGrant } from './delegation.js';
import { parseSubagentTasks, planSubagentTasks } from './planner.js';
import { listSubagentRoles } from './registry.js';
import { createTaskGraph, parallelizableBatch, topologicalBatches } from './task_graph.js';
import type { AuthorityGrant } from './types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const parentGrant: AuthorityGrant = {
  profileId: 'readonly',
  capabilities: ['read', 'git', 'eval', 'trace'],
  tools: ['read_file', 'glob', 'grep', 'list_directory', 'get_file_info', 'git'],
  resources: ['src/agent.ts', 'docs/README.md'],
};

async function main(): Promise<void> {
  const roles = listSubagentRoles();
  const roleIds = roles.map((role) => role.id).sort();
  assert(roleIds.join(',') === 'architect,builder,docs,qa,refactor,researcher,reviewer,security', 'role registry missing required roles');
  assert(roles.every((role) => !role.defaultGrant.capabilities.includes('write') && !role.defaultGrant.capabilities.includes('shell')), 'no role may grant write/shell by default');
  assert(roles.every((role) => !role.defaultGrant.capabilities.includes('mcp')), 'V1 child roles must not grant MCP/delegation capability');
  assert(roles.every((role) => role.defaultGrant.tools.every((tool) => !/(subagent|subagents|orchestrator|delegate|delegation|write_file|bash)/i.test(tool))), 'child role tool allowlists must exclude delegation/write/shell tools');

  assert(deriveEffectiveGrant({ parentGrant, roleId: 'researcher' }).capabilities.includes('read'), 'researcher should inherit read');
  let denied = false;
  try {
    deriveEffectiveGrant({ parentGrant, roleId: 'builder', requested: { capabilities: ['read', 'write'] } });
  } catch {
    denied = true;
  }
  assert(denied, 'child exceeding parent/role write grant should be denied');

  const tmpRoot = join(process.cwd(), 'tmp', `nova-subagents-smoke-${Date.now()}`);
  await mkdir(tmpRoot, { recursive: true });
  try {
    await writeFile(join(tmpRoot, 'safe.txt'), 'safe token=synthetic_token_value_12345\n', 'utf-8');
    await writeFile(join(tmpRoot, '.env'), 'LLM_API_KEY=synthetic\n', 'utf-8');
    const ctx = await buildScopedContext({ root: tmpRoot, allowlist: ['safe.txt', '.env', '../package.json', 'node_modules/pkg/index.js'] });
    assert(ctx.resources.length === 1 && ctx.resources[0]?.safePath === 'safe.txt', 'context should include only safe allowlisted file');
    assert(ctx.resources[0]?.redacted, 'context should redact secret-like content');
    assert(ctx.omissions.length >= 3, 'context denylist should omit .env/traversal/node_modules');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }

  denied = false;
  try {
    createTaskGraph([
      { id: 'a', role: 'researcher', kind: 'research', prompt: 'a', dependsOn: ['b'] },
      { id: 'b', role: 'reviewer', kind: 'review', prompt: 'b', dependsOn: ['a'] },
    ]);
  } catch {
    denied = true;
  }
  assert(denied, 'task graph cycles must be rejected');

  denied = false;
  try {
    createTaskGraph([{ id: 'build', role: 'builder', kind: 'produce', prompt: 'build', scope: ['src/a.ts'] }]);
  } catch {
    denied = true;
  }
  assert(denied, 'producer tasks must fail closed without independent verification gate');

  denied = false;
  try {
    createTaskGraph([
      { id: 'build-sec', role: 'builder', kind: 'produce', prompt: 'build auth', scope: ['src/auth.ts'], securitySensitive: true },
      { id: 'qa-build-sec', role: 'qa', kind: 'verify', prompt: 'verify auth', dependsOn: ['build-sec'], producerTaskId: 'build-sec' },
    ]);
  } catch {
    denied = true;
  }
  assert(denied, 'security-sensitive producers must require security verification gate');

  const producerGraph = createTaskGraph([
    { id: 'build-ok', role: 'builder', kind: 'produce', prompt: 'build', scope: ['src/a.ts'] },
    { id: 'verify-build-ok', role: 'qa', kind: 'verify', prompt: 'verify', dependsOn: ['build-ok'], producerTaskId: 'build-ok' },
    { id: 'docs-ok', role: 'docs', kind: 'document', prompt: 'docs', scope: ['docs/a.md'] },
    { id: 'review-docs-ok', role: 'reviewer', kind: 'review', prompt: 'review docs', dependsOn: ['docs-ok'], producerTaskId: 'docs-ok' },
    { id: 'security-ok', role: 'security', kind: 'verify', prompt: 'security review', dependsOn: ['build-ok'], producerTaskId: 'build-ok' },
  ]);
  assert(topologicalBatches(producerGraph).length === 2, 'producer verification graph should be accepted with dependent gates');

  const graph = createTaskGraph([
    { id: 'fan-a', role: 'researcher', kind: 'research', prompt: 'a', scope: ['src/a.ts'] },
    { id: 'fan-b', role: 'security', kind: 'review', prompt: 'b', scope: ['src/b.ts'] },
    { id: 'fan-in', role: 'qa', kind: 'verify', prompt: 'c', dependsOn: ['fan-a', 'fan-b'], producerTaskId: 'fan-a', scope: ['src'] },
  ]);
  const batches = topologicalBatches(graph);
  assert(batches.length === 2 && batches[0]?.length === 2 && batches[1]?.[0]?.id === 'fan-in', 'DAG should support fan-out/fan-in readiness');
  assert(parallelizableBatch(batches[0] ?? []).length === 2, 'independent read-only scopes should parallelize');

  const planned = planSubagentTasks(parseSubagentTasks({ tasks: [
    { id: 'research', role: 'researcher', kind: 'research', prompt: 'Find evidence token=synthetic_token_value_12345', scope: ['src/a.ts'] },
    { id: 'build-ok', role: 'builder', kind: 'produce', prompt: 'Plan implementation', scope: ['src/a.ts'], dependsOn: ['research'] },
    { id: 'verify-build-ok', role: 'qa', kind: 'verify', prompt: 'Verify implementation plan', dependsOn: ['build-ok'], producerTaskId: 'build-ok' },
  ] }));
  assert(planned.mode === 'metadata-only-plan' && planned.safety.invokesLlm === false && planned.safety.invokesTools === false, 'planner must be metadata-only');
  assert(planned.batches.length === 3 && planned.batches[0]?.parallelizableTaskIds.includes('research'), 'planner should expose topological batches');
  assert(!JSON.stringify(planned).includes('synthetic_token_value_12345'), 'planner prompt previews must be redacted');

  denied = false;
  try {
    assertProducerCannotSelfVerify({ id: 'build', role: 'builder', kind: 'verify', prompt: 'verify self', producerTaskId: 'build' });
  } catch {
    denied = true;
  }
  assert(denied, 'producer cannot self-verify');

  const budget = createBudgetState({ maxToolCalls: 1, maxOutputChars: 5 });
  assertBudgetAvailable(budget);
  recordBudgetUsage(budget, '123456');
  denied = false;
  try {
    assertBudgetAvailable(budget);
  } catch {
    denied = true;
  }
  assert(denied, 'budget enforcement should stop overuse');

  const tool: NovaTool = {
    name: 'read_file',
    description: 'synthetic read',
    inputSchema: z.object({}),
    capability: 'read',
    readOnly: true,
    execute: async (_input, options) => options?.actor?.actorType === 'sub_agent' && options.delegation?.delegationId ? 'ok' : 'missing actor/delegation',
  };
  const registry = new ToolRegistry();
  registry.register(tool);
  const aiTools = registry.toAITools({ policy: { actor: { actorId: 'child', actorType: 'sub_agent', parentActorId: 'root', delegationId: 'd1' }, delegation: { delegationId: 'd1', parentActorId: 'root', capabilities: ['read'], tools: ['read_file'] }, profileId: 'readonly' } });
  const output = await aiTools.read_file?.execute?.({}, { toolCallId: 'tc1', messages: [] as any, abortSignal: undefined as any });
  assert(output === 'ok', 'worker tool execution should carry actor + delegation');

  const config: AgentConfig = { llm: { provider: 'mock', baseUrl: '', apiKey: '', model: 'mock' }, systemPrompt: 'mock' };
  assert(config.systemPrompt === 'mock', 'config sanity');

  console.log('Subagents smoke passed: roles, child allowlists, authority intersection, context denylist/redaction, DAG fan-out/fan-in/cycles, producer verification gates, self-verification denial, budget, actor/delegation propagation.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
