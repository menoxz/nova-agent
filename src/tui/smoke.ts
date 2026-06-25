#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { RuntimeEventEmitter } from '../streaming/events.js';
import { StreamingEventLogStore } from '../streaming/log.js';
import { buildTuiDashboardSnapshot, renderTuiDashboardSnapshot } from './interactive.js';
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
    emitter.create({ type: 'status', message: 'Preparing safe replay' }),
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
    assert.match(rendered, /Timeline/, 'renderer includes timeline');
    assert.match(rendered, /status.*Preparing safe replay/, 'timeline includes status events');
    assert.match(rendered, /Final answer text/, 'final answer rendered');
    assert.match(rendered, /read_file/, 'tool rendered');
    const compact = new TuiReplayRenderer().render(events, { mode: 'compact' });
    assert.doesNotMatch(compact, /Timeline/, 'compact omits timeline panel');
    const verbose = new TuiReplayRenderer().render(events, { mode: 'verbose' });
    assert.match(verbose, /README content preview/, 'verbose includes longer tool previews');

    const help = runNova(['tui', '--help']);
    assert.equal(help.status, 0, 'tui help exits 0');
    assert.match(help.stdout ?? '', /nova tui\s+Open the interactive Command Center/, 'tui help documents interactive command center');
    assert.match(help.stdout ?? '', /nova tui dashboard/, 'tui help documents dashboard');
    assert.match(help.stdout ?? '', /nova tui replay <logId>/, 'tui help documents replay');
    assert.match(help.stdout ?? '', /nova tui latest/, 'tui help documents latest');
    assert.match(help.stdout ?? '', /Run agent prompt/, 'tui help documents agent prompt area');
    assert.match(help.stdout ?? '', /Sessions & runs/, 'tui help documents session area');
    assert.match(help.stdout ?? '', /Providers\/profiles/, 'tui help documents provider/profile area');
    assert.doesNotMatch((help.stderr ?? '') + (help.stdout ?? ''), /LLM_API_KEY not set/, 'tui help does not require LLM key');

    const dashboard = runNova(['tui', 'dashboard'], { NOVA_STREAMING_EVENT_LOG_ROOT: root });
    assert.equal(dashboard.status, 0, `tui dashboard exits 0: ${dashboard.stderr}`);
    assert.match(dashboard.stdout ?? '', /Nova TUI · Command Center/, 'dashboard renders command center title');
    assert.match(dashboard.stdout ?? '', /Premium panels/, 'dashboard renders premium panel list');
    assert.match(dashboard.stdout ?? '', /Keyboard shell/, 'dashboard documents keyboard shell');
    assert.match(dashboard.stdout ?? '', /Prompt streaming/, 'dashboard covers prompt streaming panel');
    assert.match(dashboard.stdout ?? '', /Onboarding\/config/, 'dashboard covers onboarding config panel');
    assert.match(dashboard.stdout ?? '', /Safety approvals/, 'dashboard covers approvals panel');
    assert.match(dashboard.stdout ?? '', /provider .*key=/, 'dashboard includes sanitized provider key presence');
    assert.match(dashboard.stdout ?? '', /sessions .*runs/, 'dashboard includes session/run counts');
    assert.match(dashboard.stdout ?? '', /readiness .*blockers=/, 'dashboard includes readiness');
    assert.match(dashboard.stdout ?? '', /secretsDisplayed=false/, 'dashboard declares no secret display');
    assert.match(dashboard.stdout ?? '', /rawNovaDisplayed=false/, 'dashboard declares no raw .nova display');
    assert.match(dashboard.stdout ?? '', /shell=disabled/, 'dashboard declares shell disabled by default');
    assert.match(dashboard.stdout ?? '', /autonomy=disabled/, 'dashboard declares autonomy disabled by default');
    assert.doesNotMatch((dashboard.stderr ?? '') + (dashboard.stdout ?? ''), /LLM_API_KEY not set/, 'dashboard does not require LLM key');

    const noInteractive = runNova(['tui', '--no-interactive'], { NOVA_STREAMING_EVENT_LOG_ROOT: root });
    assert.equal(noInteractive.status, 0, `tui --no-interactive exits 0: ${noInteractive.stderr}`);
    assert.match(noInteractive.stdout ?? '', /Non-interactive terminal detected|Command Center/, 'no-interactive renders safe snapshot');

    const replay = runNova(['tui', 'replay', 'tui_smoke_run'], { NOVA_STREAMING_EVENT_LOG_ROOT: root });
    assert.equal(replay.status, 0, `tui replay exits 0: ${replay.stderr}`);
    assert.match(replay.stdout ?? '', /Final answer text/, 'tui replay renders final answer');
    assert.match(replay.stdout ?? '', /prompt=\? completion=3 total=45/, 'tui replay renders metrics');
    assert.doesNotMatch((replay.stderr ?? '') + (replay.stdout ?? ''), /LLM_API_KEY not set/, 'tui replay does not require LLM key');

    const latest = runNova(['tui', 'latest', '--compact'], { NOVA_STREAMING_EVENT_LOG_ROOT: root });
    assert.equal(latest.status, 0, `tui latest exits 0: ${latest.stderr}`);
    assert.match(latest.stdout ?? '', /Nova TUI latest · tui_smoke_run/, 'latest selects newest event log');
    assert.match(latest.stdout ?? '', /Final answer text/, 'latest renders final answer');

    const snapshot = await buildTuiDashboardSnapshot({ llm: { provider: 'mock', baseUrl: 'http://localhost', apiKey: '', model: 'mock' }, systemPrompt: 'test', streaming: { enabled: true, mode: 'normal', eventLog: { enabled: true, root } }, session: { enabled: true } });
    assert.equal(snapshot.safety.secretsDisplayed, false, 'dashboard snapshot never displays secrets');
    assert.equal(snapshot.safety.rawNovaDisplayed, false, 'dashboard snapshot never displays raw .nova');
    assert.equal(snapshot.safety.shellDefault, 'disabled', 'dashboard snapshot keeps shell disabled by default');
    assert.ok(snapshot.panels.some((panel) => panel.id === 'approvals'), 'dashboard includes approvals panel');
    assert.ok(snapshot.panels.some((panel) => panel.id === 'run'), 'dashboard includes prompt streaming panel');
    assert.ok(snapshot.actions.includes('run prompt'), 'dashboard advertises run prompt action');
    assert.ok(snapshot.actions.includes('approvals'), 'dashboard advertises approvals action');
    assert.ok(snapshot.actions.includes('sessions'), 'dashboard advertises sessions action');
    assert.match(renderTuiDashboardSnapshot(snapshot), /Primary actions/, 'dashboard renderer includes actions');

    console.log('tui:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('tui:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
