#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { buildProductionReadinessReport } from './readiness.js';

function runNova(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function main(): void {
  const report = buildProductionReadinessReport();
  assert.equal(report.schemaVersion, 1, 'schema version is stable');
  assert.equal(report.mode, 'offline-static', 'production readiness is offline/static');
  assert.equal(report.safety.offlineOnly, true, 'offline safety flag is explicit');
  assert.equal(report.safety.readsEnv, false, 'readiness report must not read env');
  assert.equal(report.safety.readsSecrets, false, 'readiness report must not read secrets');
  assert.equal(report.safety.readsRawNovaArtifacts, false, 'readiness report must not read raw .nova artifacts');
  assert.equal(report.safety.invokesProviders, false, 'readiness report must not invoke providers');
  assert.equal(report.safety.invokesTools, false, 'readiness report must not invoke tools');
  assert.equal(report.safety.usesNetwork, false, 'readiness report must not use network');
  assert.equal(report.safety.publishesOrTags, false, 'readiness report must not publish or tag');
  assert.equal(report.package.version, '0.1.0', 'package version remains unchanged');
  assert.equal(report.installableNow.repoDevCli, true, 'repo CLI bin is available');
  assert.equal(report.installableNow.mcpStdioCandidate, true, 'MCP stdio bin is available');
  assert.equal(report.installableNow.npmPublishReady, false, 'npm publish remains out of scope');
  assert.equal(report.readiness.criticalBlockedCount, 0, 'no active critical install blockers remain');
  assert.ok(report.explicitOutOfScope.some((item) => item.includes('npm publish')), 'release network actions stay out of scope');
  assert.ok(report.explicitOutOfScope.some((item) => item.includes('Live provider')), 'live provider actions stay out of scope');

  const cli = runNova(['production', 'readiness']);
  assert.equal(cli.status, report.readiness.ready ? 0 : 1, `production readiness CLI has expected exit code: ${cli.stderr}`);
  assert.match(cli.stdout, /production-install-readiness-v1/, 'CLI prints production readiness report');
  assert.doesNotMatch(cli.stdout + cli.stderr, /LLM_API_KEY not set/, 'CLI does not require LLM_API_KEY');

  console.log(`production:smoke passed ready=${report.readiness.ready} blockers=${report.readiness.blockedCount} warnings=${report.readiness.warningCount}`);
}

try {
  main();
} catch (err) {
  console.error('production:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
