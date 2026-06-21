#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

import { SessionRunManager } from './manager.js';
import { RunReplayManager } from './replay.js';
import { RunResumeManager } from './resume.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-replay-smoke-'));
  try {
    const base = { projectRoot: root, enabled: true };
    const manager = new SessionRunManager(base);
    const session = await manager.createSession({ title: 'Replay smoke', objective: 'Validate run replay/resume' });
    const run = await manager.startRun({ sessionId: session.id, objective: 'Edit a file after approval', input: 'Need a write tool approval before editing.' });
    await manager.requestApproval(session.id, run.id, { capability: 'write', action: 'tool:write_file', riskLevel: 'medium', reason: 'write requires explicit approval', safeMetadata: { toolName: 'write_file', pathKind: 'project' } });
    await manager.decideApproval(session.id, run.id, 'approval_1', 'approved', { reason: 'approved for resume smoke' });

    const replay = await new RunReplayManager(base).replay(session.id, run.id);
    assert.equal(replay.safety.metadataOnly, true, 'replay is metadata-only');
    assert.equal(replay.safety.llmInvoked, false, 'replay does not invoke LLM');
    assert.equal(replay.safety.toolsInvoked, false, 'replay does not invoke tools');
    assert.equal(replay.approvals[0]?.status, 'approved', 'approval is visible in replay metadata');

    const child = await new RunResumeManager(base).resume({ sessionId: session.id, runId: run.id, reason: 'continue after approval' });
    assert.equal(child.status, 'planned', 'resume child is planned, not auto-running');
    assert.equal(child.relationships?.parentRunId, run.id, 'child records parent run');
    assert.deepEqual(child.resume?.approvedApprovalIds, ['approval_1'], 'approved approval ids are metadata only');
    assert.equal(child.resume?.safety.autoExecuteApprovedActions, false, 'resume does not auto-execute approved action');
    assert.equal(child.resume?.safety.llmInvoked, false, 'resume creation does not invoke LLM');
    assert.equal(child.approvals.length, 0, 'child starts with no copied executable approvals');

    const source = await manager.store.getRun(session.id, run.id);
    assert.ok(source?.relationships?.childRunIds?.includes(child.id), 'source links child run');
    assert.equal((await manager.store.getSession(session.id))?.activeRunId, child.id, 'session active run points to child');

    console.log('replay:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('replay:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
