#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildProviderReadinessReport } from './readiness.js';

function main(): void {
  const report = buildProviderReadinessReport();
  assert.equal(report.schemaVersion, 1, 'schema version is stable');
  assert.equal(report.mode, 'offline-static', 'readiness report is static/offline');
  assert.equal(report.safety.offlineOnly, true, 'offline-only safety flag is explicit');
  assert.equal(report.safety.readsEnv, false, 'readiness report must not read env');
  assert.equal(report.safety.readsSecrets, false, 'readiness report must not read secrets');
  assert.equal(report.safety.readsRawNovaArtifacts, false, 'readiness report must not read raw .nova artifacts');
  assert.equal(report.safety.invokesProviders, false, 'readiness report must not invoke providers');
  assert.equal(report.safety.usesNetwork, false, 'readiness report must not use network');
  assert.equal(report.safety.startsDaemonOrAutonomy, false, 'readiness report must not start daemon/autonomy');

  assert.ok(report.inventory.profileCount >= 20, 'provider profiles are inventoried');
  assert.ok(report.inventory.directoryCount >= 140, 'provider directory is inventoried');
  assert.ok(report.inventory.directoryCategories['runtime-supported'] >= 5, 'runtime-supported providers are counted');
  assert.ok(report.inventory.directoryCategories.planned >= 80, 'planned providers are counted');
  assert.ok(report.inventory.profileProtocols['openai-chat-completions'] > 0, 'OpenAI-compatible protocols are counted');
  assert.ok(report.inventory.profileProtocols['anthropic-messages'] > 0, 'Anthropic-compatible protocols are counted');
  assert.ok(report.inventory.providerAdapters.includes('openrouter'), 'runtime adapters are listed');

  const futureGate = report.gates.find((gate) => gate.id === 'future-live-smoke');
  assert.equal(futureGate?.status, 'blocked', 'future live smoke remains blocked');
  assert.equal(report.futureLiveAuthorization.required, true, 'future live smoke requires explicit authorization');
  assert.ok(report.outOfScope.some((item) => item.includes('live provider/LLM/network calls')), 'live calls are out of scope');

  console.log(`providers:readiness-smoke passed profiles=${report.inventory.profileCount} directory=${report.inventory.directoryCount} mode=${report.mode}`);
}

try {
  main();
} catch (err) {
  console.error('providers:readiness-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
