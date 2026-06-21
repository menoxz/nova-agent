#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RuntimeEventEmitter } from './events.js';
import { StreamingEventLogStore, eventLogId, sanitizeRuntimeEvent } from './log.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-streaming-log-smoke-'));
  try {
    const store = new StreamingEventLogStore({ enabled: true, root: '.nova/streaming/events', includeText: true, maxTextChars: 80, maxEvents: 10 }, root);
    const emitter = new RuntimeEventEmitter({ sessionId: 'ses_test', runId: 'run_test' });
    const token = emitter.create({ type: 'token', text: 'hello apiKey=sk-12345678901234567890 world', completionTokens: 4, elapsedMs: 100 });
    const tool = emitter.create({ type: 'tool_call', toolName: 'read_file', inputPreview: JSON.stringify({ path: 'README.md', apiKey: 'sk-12345678901234567890' }) });
    await store.append(token);
    await store.append(tool);

    const logId = eventLogId(token);
    assert.equal(logId, 'ses_test__run_test', 'log id uses session/run');
    const events = await store.read(logId);
    assert.equal(events.length, 2, 'events read back from jsonl');
    assert.equal(events[0]?.sequence, 1, 'sequence preserved');
    assert.equal(events[0]?.type === 'token' ? events[0].completionTokens : undefined, 4, 'safe numeric token metrics are preserved');
    assert.doesNotMatch(JSON.stringify(events), /sk-12345678901234567890/, 'secret-like values redacted');

    const summaries = await store.list();
    assert.equal(summaries.length, 1, 'list returns one log');
    assert.equal(summaries[0]?.logId, logId, 'summary exposes log id');

    const omitted = sanitizeRuntimeEvent(token, { enabled: true, root: '.nova/streaming/events', includeText: false, maxTextChars: 80, maxEvents: 10 });
    assert.match(omitted.type === 'token' ? omitted.text : '', /omitted/, 'includeText=false omits token text');

    console.log('streaming:log-smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('streaming:log-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
