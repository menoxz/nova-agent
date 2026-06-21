#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

import { ConversationStore } from './conversation.js';
import { CurrentSessionStore } from './current.js';
import { RunReplayManager } from './replay.js';
import { RunResumeManager } from './resume.js';
import { SessionRunManager } from './manager.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-current-smoke-'));
  try {
    const config = { projectRoot: root, enabled: true };
    const manager = new SessionRunManager(config);
    const currentStore = new CurrentSessionStore(config);
    const session = await manager.createSession({ title: 'Current smoke', objective: 'Validate current session UX' });
    const run = await manager.startRun({ sessionId: session.id, objective: 'Current run', input: 'Need current session pointer' });

    const pointer = await currentStore.set({ sessionId: session.id, runId: run.id, source: 'cli' });
    assert.equal(pointer.sessionId, session.id, 'current session id set');
    assert.equal(pointer.runId, run.id, 'current run id set');
    assert.equal(pointer.safety.metadataOnly, true, 'pointer is metadata-only');
    assert.equal(pointer.safety.rawPromptsIncluded, false, 'pointer stores no raw prompts');

    const replay = await new RunReplayManager(config).replay(pointer.sessionId, pointer.runId!);
    assert.equal(replay.runId, run.id, 'current run can be reported');

    await manager.finishRun(session.id, run.id, { status: 'failed', summary: 'Blocker: approval needed. Next step: resume-current.' });
    const child = await new RunResumeManager(config).resume({ sessionId: pointer.sessionId, runId: pointer.runId!, reason: 'resume current smoke' });
    const afterResume = await currentStore.requireCurrent();
    assert.equal(afterResume.sessionId, session.id, 'resume keeps same current session');
    assert.equal(afterResume.runId, child.id, 'resume updates current run to child');
    assert.equal(afterResume.source, 'resume', 'resume source recorded');

    await new ConversationStore(config).addTurn({ sessionId: session.id, run: child, userInput: 'current conversation summary', assistantText: 'Decision: current session can omit ids. Next step: use conversations summary.' });
    const currentSessionId = (await currentStore.requireCurrent()).sessionId;
    const summary = await new ConversationStore(config).summary(currentSessionId);
    assert.ok(summary.text.includes('conversation_summary'), 'conversation summary works from current session id');

    const unset = await currentStore.unset();
    assert.equal(unset.removed, true, 'unset-current removes pointer');
    assert.equal(await currentStore.get(), undefined, 'current pointer removed');

    console.log('current:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('current:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
