#!/usr/bin/env node
import assert from 'node:assert/strict';

import { StreamingCliRenderer, safePreview } from './index.js';
import { RuntimeEventEmitter } from './events.js';
import { DEFAULT_STREAMING_CONFIG, resolveStreamingConfig, type StreamingEvent } from './types.js';

function captureStdout(fn: () => void): string {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

async function main(): Promise<void> {
  const resolved = resolveStreamingConfig({ enabled: true, showTools: false, thinkingMode: 'expanded' });
  assert.equal(resolved.enabled, true, 'enabled can be configured');
  assert.equal(resolved.showTools, false, 'tool visibility can be disabled');
  assert.equal(resolved.thinkingMode, 'expanded', 'thinking mode can be configured');
  assert.equal(DEFAULT_STREAMING_CONFIG.thinkingMode, 'collapsed', 'thinking collapsed by default');

  const preview = safePreview({ apiKey: 'sk-12345678901234567890', value: 'ok' });
  assert.match(preview, /redacted/i, 'tool previews redact secret-like keys');
  assert.doesNotMatch(preview, /sk-12345678901234567890/, 'tool preview does not leak secret value');

  const renderer = new StreamingCliRenderer({ enabled: true, showMetrics: false, thinkingMode: 'collapsed' });
  const emitter = new RuntimeEventEmitter({ sessionId: 's1', runId: 'r1' });
  const events: StreamingEvent[] = [
    emitter.create({ type: 'start', model: 'mock-model', estimatedPromptTokens: 42 }),
    emitter.create({ type: 'reasoning_start', id: 'think-1' }),
    emitter.create({ type: 'reasoning_delta', id: 'think-1', text: 'safe visible reasoning', elapsedMs: 10 }),
    emitter.create({ type: 'reasoning_end', id: 'think-1', text: 'safe visible reasoning' }),
    emitter.create({ type: 'tool_call', toolName: 'read_file', inputPreview: safePreview({ path: 'README.md' }) }),
    emitter.create({ type: 'tool_result', toolName: 'read_file', outputPreview: 'ok', ok: true }),
    emitter.create({ type: 'token', text: 'Hello', completionTokens: 2, elapsedMs: 100 }),
    emitter.create({ type: 'finish', text: 'Hello', elapsedMs: 100, toolCallCount: 1, metrics: { source: 'estimated', promptTokens: 42, completionTokens: 2, totalTokens: 44, responseDurationMs: 100, responseTokensPerSecond: 20 } }),
  ];
  const output = captureStdout(() => events.forEach(renderer.handle));
  assert.match(output, /Nova streaming run/, 'header rendered');
  assert.match(output, /thinking collapsed/, 'collapsed thinking rendered');
  assert.match(output, /read_file/, 'tool event rendered');
  assert.match(output, /Summary/, 'final summary rendered');
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8], 'events are sequenced for TUI consumption');

  const compact = new StreamingCliRenderer({ enabled: true, mode: 'compact', showMetrics: false, showTools: true });
  const compactOutput = captureStdout(() => events.forEach(compact.handle));
  assert.match(compactOutput, /Nova streaming/, 'compact mode renders a minimal header');
  assert.doesNotMatch(compactOutput, /╭─ Summary/, 'compact mode avoids boxed summary noise');

  console.log('streaming:smoke passed');
}

main().catch((err) => {
  console.error('streaming:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
