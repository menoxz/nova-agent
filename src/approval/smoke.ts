#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { ApprovalManager } from './manager.js';
import { createApprovalPolicyHook } from './policy_bridge.js';
import { SessionRunManager } from '../session/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import type { NovaTool } from '../types.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-approval-smoke-'));
  try {
    const sessionConfig = { enabled: true, projectRoot: root };
    const runManager = new SessionRunManager(sessionConfig);
    const session = await runManager.createSession({ title: 'Approval smoke' });
    const run = await runManager.startRun({ sessionId: session.id, objective: 'Need write approval', input: 'Write a file after approval' });

    const hook = createApprovalPolicyHook(sessionConfig, { sessionId: session.id, runId: run.id });
    const decision = await hook({ actor: { actorId: 'approval-smoke', actorType: 'root_agent' }, profileId: 'developer', capability: 'write', action: 'tool:write_file', toolName: 'write_file', readOnly: false, riskLevel: 'medium' });
    assert.equal(decision.decision, 'ask', 'write policy asks');

    const manager = new ApprovalManager(sessionConfig);
    const pending = await manager.list('pending');
    assert.equal(pending.length, 1, 'approval request persisted');
    assert.equal(pending[0]?.runId, run.id, 'approval linked to run');

    const approved = await manager.decide({ approvalId: pending[0]!.approvalId, decision: 'approved', reason: 'smoke approval' });
    assert.equal(approved.status, 'approved', 'approval approved');

    const writeTool: NovaTool = { name: 'write_file', description: 'Synthetic write tool', inputSchema: z.object({}), readOnly: false, capability: 'write', riskLevel: 'medium', execute: async () => 'should not execute' };
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const tools = registry.toAITools({ policy: { enabled: true, profileId: 'developer', hook } });
    const result = await (tools.write_file as any).execute({});
    assert.match(String(result), /Policy ask/, 'tool remains blocked without runtime approval replay');
    console.log('approval:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('approval:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
