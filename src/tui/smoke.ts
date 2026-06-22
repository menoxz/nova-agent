#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { RuntimeEventEmitter } from '../streaming/events.js';
import { StreamingEventLogStore } from '../streaming/log.js';
import { summarizeTuiReplay, TuiReplayRenderer } from './renderer.js';

function runNova(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', ...env },
  });
}

async function main(): Promise<void> {
  const root = '.nova/tui-smoke-events';
  const store = new StreamingEventLogStore({ enabled: true, root, includeText: true, maxTextChars: 500, maxEvents: 100 });
  const emitter = new RuntimeEventEmitter({ runId: 'tui_smoke_run' });
  const events = [
    emitter.create({ type: 'start', model: 'mock-model', estimatedPromptTokens: 42 }),
    emitter.create({ type: 'reasoning_end', text: 'safe short reasoning' }),
    emitter.create({ type: 'tool_call', toolName: 'read_file', inputPreview: '{"path":"README.md"}' }),
    emitter.create({ type: 'tool_result', toolName: 'read_file', outputPreview: 'README content preview', ok: true }),
    emitter.create({ type: 'finish', text: 'Final answer text', elapsedMs: 1200, toolCallCount: 1, metrics: { source: 'estimated', completionTokens: 3, totalTokens: 45, responseDurationMs: 1200, responseTokensPerSecond: 2.5 } }),
  ];
  try {
    for (const event of events) await store.append(event);
    const summary = summarizeTuiReplay(events);
    assert.equal(summary.status, 'finished', 'summary status finished');
    assert.equal(summary.toolCallCount, 1, 'tool call counted');
    const rendered = new TuiReplayRenderer().render(events);
    assert.match(rendered, /Nova TUI replay/, 'renderer title shown');
    assert.match(rendered, /Final answer text/, 'final answer rendered');
    assert.match(rendered, /read_file/, 'tool rendered');

    const help = runNova(['tui', '--help']);
    assert.equal(help.status, 0, 'tui help exits 0');
    assert.match(help.stdout ?? '', /nova tui replay <logId>/, 'tui help documents replay');
    assert.doesNotMatch((help.stderr ?? '') + (help.stdout ?? ''), /LLM_API_KEY not set/, 'tui help does not require LLM key');

    const replay = runNova(['tui', 'replay', 'tui_smoke_run'], { NOVA_STREAMING_EVENT_LOG_ROOT: root });
    assert.equal(replay.status, 0, `tui replay exits 0: ${replay.stderr}`);
    assert.match(replay.stdout ?? '', /Final answer text/, 'tui replay renders final answer');
    assert.match(replay.stdout ?? '', /prompt=\? completion=3 total=45/, 'tui replay renders metrics');
    assert.doesNotMatch((replay.stderr ?? '') + (replay.stdout ?? ''), /LLM_API_KEY not set/, 'tui replay does not require LLM key');

    console.log('tui:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('tui:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
