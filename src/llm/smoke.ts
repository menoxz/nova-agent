#!/usr/bin/env node
import assert from 'node:assert/strict';

import { classifyLlmError, formatLlmError, resolveLlmRobustnessConfig, withLlmRetry } from './robustness.js';

async function main(): Promise<void> {
  assert.equal(resolveLlmRobustnessConfig({ timeoutMs: 100, retries: 2 }).timeoutMs, 100, 'timeout configurable');
  assert.equal(resolveLlmRobustnessConfig({ retries: 99 }).retries, 5, 'retries capped safely');

  assert.equal(classifyLlmError({ statusCode: 401, message: 'bad key' }).kind, 'auth', 'auth classified');
  assert.equal(classifyLlmError({ statusCode: 429, message: 'rate limit' }).kind, 'rate_limit', 'rate limit classified');
  assert.equal(classifyLlmError(new DOMException('aborted', 'AbortError')).kind, 'timeout', 'abort classified as timeout');
  assert.equal(classifyLlmError({ statusCode: 404, message: 'route not found' }).kind, 'endpoint_incompatible', 'endpoint mismatch classified');
  assert.equal(classifyLlmError({ statusCode: 503, message: 'unavailable' }).kind, 'provider_5xx', '5xx classified');
  assert.equal(classifyLlmError(new Error('fetch failed ECONNRESET')).kind, 'network', 'network classified');
  assert.equal(classifyLlmError(new Error('Cannot connect to API: bad port')).kind, 'network', 'bad port classified as network');
  assert.match(formatLlmError({ statusCode: 404, message: 'route not found' }, { provider: 'openmodel', model: 'm', baseUrl: 'https://api.example.test/v1' }), /endpoint_incompatible/, 'diagnostic includes kind');

  let attempts = 0;
  const result = await withLlmRetry(async () => {
    attempts += 1;
    if (attempts < 2) throw { statusCode: 503, message: 'temporary outage' };
    return 'ok';
  }, { retries: 2, retryBackoffMs: 1 });
  assert.equal(result, 'ok', 'retry returns eventual success');
  assert.equal(attempts, 2, 'retry attempted once');

  attempts = 0;
  await assert.rejects(() => withLlmRetry(async () => {
    attempts += 1;
    const err = new Error('unauthorized') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }, { retries: 2, retryBackoffMs: 1 }), /unauthorized/, 'non retryable auth fails immediately');
  assert.equal(attempts, 1, 'auth was not retried');

  console.log('llm:smoke passed');
}

main().catch((err) => {
  console.error('llm:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
