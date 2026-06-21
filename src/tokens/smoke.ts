#!/usr/bin/env node
import assert from 'node:assert/strict';

import { compactTextToTokenBudget, estimateTokenCost, estimateTokenUsage, estimateTokens, extractTokenUsage, responseTokenMetrics, tokensPerSecond } from './index.js';

function main(): void {
  assert.equal(estimateTokens('abcd'), 1, '4 chars ~= 1 token');
  assert.equal(estimateTokenUsage({ promptText: 'abcdefgh', completionText: 'abcd' }).totalTokens, 3, 'usage totals estimates');
  assert.equal(tokensPerSecond(50, 1_000), 50, 'tokens/sec computed');
  const providerUsage = extractTokenUsage({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
  assert.equal(providerUsage?.source, 'provider', 'provider usage extracted');
  const metrics = responseTokenMetrics({ usage: providerUsage, completionText: 'hello world', responseDurationMs: 500, pricing: { currency: 'USD', inputCostPer1MTokens: 1, outputCostPer1MTokens: 2, source: 'smoke' } });
  assert.equal(metrics.responseTokensPerSecond, 10, 'provider completion speed uses completion tokens');
  assert.equal(metrics.cost?.totalCost, 0.00002, 'cost estimate uses configured per-1M token pricing');
  assert.equal(estimateTokenCost({ promptTokens: 1_000_000, completionTokens: 500_000, source: 'provider', pricing: { currency: 'EUR', inputCostPer1MTokens: 3, outputCostPer1MTokens: 6 } })?.totalCost, 6, 'direct cost estimate works');
  const compacted = compactTextToTokenBudget(Array.from({ length: 100 }, (_, i) => `line ${i}: important context detail`).join('\n'), 60, { reason: 'smoke' });
  assert.equal(compacted.compacted, true, 'long text compacts');
  assert.ok(compacted.compactedTokens <= 60, 'compaction respects budget');
  assert.match(compacted.text, /compacted/, 'compaction marker explains omission');
  console.log('tokens:smoke passed');
}

try { main(); } catch (err) {
  console.error('tokens:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
