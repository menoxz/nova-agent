#!/usr/bin/env bun
import assert from 'node:assert/strict';

import { buildTuiDashboardSnapshot } from './index.js';
import { renderOpenTuiVerticalSliceForTest } from './opentui_app.js';

async function main(): Promise<void> {
  const snapshot = await buildTuiDashboardSnapshot({
    llm: { provider: 'mock', baseUrl: 'http://localhost', apiKey: '', model: 'mock' },
    systemPrompt: 'test',
    streaming: { enabled: true, mode: 'normal', eventLog: { enabled: true, root: '.nova/tui-opentui-smoke-events' } },
    session: { enabled: true },
    profile: { id: 'nova.builder', name: 'Nova Builder', version: '1', hash: 'smoke', source: 'builtin', mode: 'root', policyProfileId: 'developer' },
  });

  const result = await renderOpenTuiVerticalSliceForTest(snapshot);
  assert.match(result.frame, /Nova OpenTUI/, 'vertical slice renders OpenTUI header');
  assert.match(result.frame, /Click panels/, 'vertical slice renders mouse sidebar');
  assert.match(result.frame, /Prompt input/, 'vertical slice renders prompt input');
  assert.match(result.frame, /secretsDisplayed=false/, 'vertical slice declares no secret display');
  assert.match(result.frame, /rawNovaDisplayed=false/, 'vertical slice declares no raw .nova display');
  assert.equal(result.hasPromptInput, true, 'prompt input is present');
  assert.equal(result.mouseActivated, true, `mouse click activates dashboard panel\n${result.mouseFrame}`);
  assert.equal(result.keyboardActivated, true, 'keyboard hotkey activates run panel');
  console.log('tui:opentui-smoke passed');
}

main().catch((err) => {
  console.error('tui:opentui-smoke failed:', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
