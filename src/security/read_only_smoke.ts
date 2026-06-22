#!/usr/bin/env node
import assert from 'node:assert/strict';

import { findMatrixEntry, isDangerousOrMutating, isPureReadOnly, readOnlySafetyMatrix, type SafetyMatrixEntry } from './read_only_matrix.js';

function must(id: string): SafetyMatrixEntry {
  const entry = findMatrixEntry(id);
  assert.ok(entry, `missing smoke target: ${id}`);
  return entry;
}

function assertNoLiveOrStatefulBehavior(entry: SafetyMatrixEntry): void {
  assert.equal(entry.flags.provider, false, `${entry.id}: must not invoke provider`);
  assert.equal(entry.flags.createsAgent, false, `${entry.id}: must not create agent`);
  assert.equal(entry.flags.registersOrExecutesTools, false, `${entry.id}: must not register or execute tools`);
  assert.equal(entry.flags.network, false, `${entry.id}: must not use network`);
  assert.notEqual(entry.flags.filesystemWrites, 'mutating', `${entry.id}: must not perform mutating writes`);
  assert.notEqual(entry.flags.filesystemWrites, 'unknown', `${entry.id}: must have known write behavior`);
}

function smokeSafeReadOnlyCommands(): void {
  const safeIds = [
    'cli.help',
    'cli.version',
    'cli.config.validate',
    'cli.config.explain',
    'cli.providers.list',
    'cli.providers.show',
    'cli.providers.doctor',
    'cli.eval.list',
    'cli.eval.report',
    'cli.eval.compare',
    'cli.heartbeat.validate',
    'cli.heartbeat.status',
    'cli.heartbeat.tasks',
    'cli.heartbeat.report',
    'cli.sessions.list-show-current',
    'cli.runs.list-show-report',
    'cli.approvals.list',
    'cli.conversations.show-summary',
  ];

  for (const id of safeIds) {
    const entry = must(id);
    assert.equal(entry.orchestratorReadOnlyCompatible, true, `${id}: expected read-only compatibility`);
    assertNoLiveOrStatefulBehavior(entry);
  }
}

function smokePureReadOnlyInvariant(): void {
  for (const entry of readOnlySafetyMatrix.filter(isPureReadOnly)) {
    assert.equal(entry.flags.filesystemWrites, 'none', `${entry.id}: pure-read-only must not write`);
    assert.equal(entry.flags.shell && entry.surface !== 'package-script' && entry.surface !== 'built-in-tool', false, `${entry.id}: unexpected shell use`);
    assertNoLiveOrStatefulBehavior(entry);
  }
}

function smokeDryRunMetadataEntries(): void {
  const dryRunIds = ['cli.batch.dry-run', 'cli.heartbeat.tick.dry-run', 'script.smokes.safe', 'script.check-fast'];
  for (const id of dryRunIds) {
    const entry = must(id);
    assert.equal(entry.orchestratorReadOnlyCompatible, true, `${id}: dry-run/smoke should be compatible`);
    assert.equal(entry.flags.provider, false, `${id}: no provider allowed`);
    assert.equal(entry.flags.network, false, `${id}: no network allowed`);
    assert.ok(entry.flags.filesystemWrites === 'metadata-only' || entry.flags.filesystemWrites === 'user-requested', `${id}: must only write metadata/temp outputs`);
  }
}

function smokeDangerousEntriesBlocked(): void {
  const dangerousIds = [
    'cli.prompt-interactive',
    'cli.batch.live',
    'cli.heartbeat.tick.live',
    'cli.eval.runner',
    'script.dev-start',
    'script.build-prepack',
    'script.eval-mock',
    'script.publish-pack-live',
    'tool.write-file',
    'tool.bash',
    'tool.web-search',
    'category.daemon-autonomy',
    'category.provider-live',
    'category.release-network',
  ];
  for (const id of dangerousIds) {
    const entry = must(id);
    assert.ok(isDangerousOrMutating(entry), `${id}: expected dangerous/live/mutating classification`);
    assert.equal(entry.orchestratorReadOnlyCompatible, false, `${id}: must not be read-only compatible`);
  }
}

function smokeSensitiveArtifactGuards(): void {
  const sensitive = must('category.sensitive-artifacts');
  assert.equal(sensitive.orchestratorReadOnlyCompatible, false, 'sensitive artifacts must be blocked');
  assert.equal(sensitive.flags.secretsEnvRisk, true, 'sensitive artifacts must track secrets/.env risk');
  assert.equal(sensitive.flags.rawNovaRisk, true, 'sensitive artifacts must track raw .nova risk');
  assert.equal(sensitive.flags.outsideRootRisk, true, 'sensitive artifacts must track outside-root risk');

  const readFamily = must('tool.read-file-family');
  assert.equal(readFamily.classification, 'read-only-sensitive', 'read tools must be read-only-sensitive, not pure read-only');
  assert.equal(readFamily.flags.secretsEnvRisk, true, 'read tools must track secret risk');
  assert.equal(readFamily.flags.rawNovaRisk, true, 'read tools must track raw .nova risk');
  assert.equal(readFamily.flags.outsideRootRisk, true, 'read tools must track outside-root risk');
}

function main(): void {
  smokeSafeReadOnlyCommands();
  smokePureReadOnlyInvariant();
  smokeDryRunMetadataEntries();
  smokeDangerousEntriesBlocked();
  smokeSensitiveArtifactGuards();
  console.log(`security:readonly-smoke passed entries=${readOnlySafetyMatrix.length}`);
}

try {
  main();
} catch (err) {
  console.error('security:readonly-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
