#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { analyzePackageScriptCoverage, findMatrixEntry, isDangerousOrMutating, readOnlySafetyMatrix } from './read_only_matrix.js';

type CliResult = { status: number | null; stdout: string; stderr: string };

function runNova(args: string[]): CliResult {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function main(): void {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { scripts: Record<string, string> };
  const coverage = analyzePackageScriptCoverage(Object.keys(packageJson.scripts));
  assert.deepEqual(coverage.missingScripts, [], `all package scripts must be covered by security matrix: ${coverage.missingScripts.join(', ')}`);
  assert.deepEqual(coverage.unknownMatrixIds, [], `all coverage matrix ids must exist: ${coverage.unknownMatrixIds.join(', ')}`);

  for (const id of ['script.llm-live-smoke', 'script.autoexec-live-smoke', 'script.mcp-bin-smoke-build-link', 'script.publish-pack-live']) {
    const entry = findMatrixEntry(id);
    assert.ok(entry, `missing matrix entry ${id}`);
    assert.ok(isDangerousOrMutating(entry), `${id} must remain dangerous/live/mutating`);
    assert.equal(entry.orchestratorReadOnlyCompatible, false, `${id} must not be read-only compatible`);
  }

  for (const id of ['script.release-readiness', 'script.local-integration-smokes']) {
    const entry = findMatrixEntry(id);
    assert.ok(entry, `missing matrix entry ${id}`);
    assert.equal(entry.orchestratorReadOnlyCompatible, true, `${id} should be local validation compatible`);
    assert.equal(entry.flags.provider, false, `${id} must not invoke provider`);
    assert.equal(entry.flags.network, false, `${id} must not use network`);
  }

  const doctor = runNova(['security', 'doctor']);
  assert.equal(doctor.status, 0, `security doctor exits 0: ${doctor.stderr}`);
  assert.match(doctor.stdout, /"ok": true/, 'security doctor reports ok');
  assert.match(doctor.stdout, /"missingScripts": \[\]/, 'security doctor has no missing scripts');
  assert.doesNotMatch(doctor.stderr + doctor.stdout, /LLM_API_KEY not set/, 'security doctor must not require LLM_API_KEY');

  const matrix = runNova(['security', 'matrix', '--classification', 'live-provider']);
  assert.equal(matrix.status, 0, `security matrix exits 0: ${matrix.stderr}`);
  assert.match(matrix.stdout, /script\.llm-live-smoke/, 'filtered matrix includes live-smoke entry');
  assert.doesNotMatch(matrix.stderr + matrix.stdout, /LLM_API_KEY not set/, 'security matrix must not require LLM_API_KEY');

  assert.ok(readOnlySafetyMatrix.length >= 58, 'matrix should include V1.1 coverage entries');
  console.log(`security:smoke passed entries=${readOnlySafetyMatrix.length} scripts=${coverage.totalScripts}`);
}

try {
  main();
} catch (err) {
  console.error('security:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
