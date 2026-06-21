#!/usr/bin/env node
import assert from 'node:assert/strict';

import { StreamingCliRenderer, safePreview } from './index.js';
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
  const events: StreamingEvent[] = [
    { type: 'start', timestamp: new Date().toISOString(), model: 'mock-model', sessionId: 's1', runId: 'r1', estimatedPromptTokens: 42 },
    { type: 'reasoning_start', timestamp: new Date().toISOString(), id: 'think-1' },
    { type: 'reasoning_delta', timestamp: new Date().toISOString(), id: 'think-1', text: 'safe visible reasoning', elapsedMs: 10 },
    { type: 'reasoning_end', timestamp: new Date().toISOString(), id: 'think-1', text: 'safe visible reasoning' },
    { type: 'tool_call', timestamp: new Date().toISOString(), toolName: 'read_file', inputPreview: safePreview({ path: 'README.md' }) },
    { type: 'tool_result', timestamp: new Date().toISOString(), toolName: 'read_file', outputPreview: 'ok', ok: true },
    { type: 'token', timestamp: new Date().toISOString(), text: 'Hello', completionTokens: 2, elapsedMs: 100 },
    { type: 'finish', timestamp: new Date().toISOString(), text: 'Hello', elapsedMs: 100, toolCallCount: 1, metrics: { source: 'estimated', promptTokens: 42, completionTokens: 2, totalTokens: 44, responseDurationMs: 100, responseTokensPerSecond: 20 } },
  ];
  const output = captureStdout(() => events.forEach(renderer.handle));
  assert.match(output, /Nova streaming run/, 'header rendered');
  assert.match(output, /thinking collapsed/, 'collapsed thinking rendered');
  assert.match(output, /read_file/, 'tool event rendered');
  assert.match(output, /Summary/, 'final summary rendered');

  console.log('streaming:smoke passed');
}

main().catch((err) => {
  console.error('streaming:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
