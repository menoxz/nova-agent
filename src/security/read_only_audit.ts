#!/usr/bin/env node
import assert from 'node:assert/strict';

import { isDangerousOrMutating, isPureReadOnly, readOnlySafetyMatrix, type SafetyMatrixEntry } from './read_only_matrix.js';

const requiredCliIds = [
  'cli.help',
  'cli.version',
  'cli.config.validate',
  'cli.config.explain',
  'cli.config.show',
  'cli.config.init',
  'cli.providers.list',
  'cli.providers.show',
  'cli.providers.doctor',
  'cli.batch.dry-run',
  'cli.batch.live',
  'cli.eval.list',
  'cli.eval.report',
  'cli.eval.summary',
  'cli.eval.compare',
  'cli.eval.dashboard',
  'cli.eval.runner',
  'cli.heartbeat.validate',
  'cli.heartbeat.status',
  'cli.heartbeat.tasks',
  'cli.heartbeat.tick.dry-run',
  'cli.heartbeat.tick.live',
  'cli.heartbeat.report',
  'cli.sessions.list-show-current',
  'cli.runs.list-show-report',
  'cli.approvals.list',
  'cli.conversations.show-summary',
  'cli.prompt-interactive',
];

const requiredScriptIds = [
  'script.typecheck',
  'script.check-fast',
  'script.check',
  'script.dev-start',
  'script.build-prepack',
  'script.smokes.safe',
  'script.eval-mock',
  'script.pack-dry-run',
  'script.publish-pack-live',
];

const requiredToolIds = [
  'tool.read-file-family',
  'tool.write-file',
  'tool.bash',
  'tool.git',
  'tool.goal-todo-skill',
  'tool.web-search',
];

const requiredCategoryIds = [
  'category.daemon-autonomy',
  'category.provider-live',
  'category.release-network',
  'category.sensitive-artifacts',
];

function ids(): Set<string> {
  return new Set(readOnlySafetyMatrix.map((entry) => entry.id));
}

function entryById(id: string): SafetyMatrixEntry {
  const found = readOnlySafetyMatrix.find((entry) => entry.id === id);
  assert.ok(found, `missing matrix entry: ${id}`);
  return found;
}

function assertRequiredCoverage(): void {
  const allIds = ids();
  const duplicates = readOnlySafetyMatrix
    .map((entry) => entry.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `duplicate matrix ids: ${duplicates.join(', ')}`);

  for (const id of [...requiredCliIds, ...requiredScriptIds, ...requiredToolIds, ...requiredCategoryIds]) {
    assert.ok(allIds.has(id), `required read-only audit coverage missing: ${id}`);
  }
}

function assertPureReadOnlyInvariant(entry: SafetyMatrixEntry): void {
  assert.equal(entry.orchestratorReadOnlyCompatible, true, `${entry.id}: pure read-only must be orchestrator-compatible`);
  assert.equal(entry.flags.filesystemWrites, 'none', `${entry.id}: pure read-only must not write filesystem`);
  assert.equal(entry.flags.provider, false, `${entry.id}: pure read-only must not invoke provider`);
  assert.equal(entry.flags.createsAgent, false, `${entry.id}: pure read-only must not create agent`);
  assert.equal(entry.flags.registersOrExecutesTools, false, `${entry.id}: pure read-only must not register/execute tools`);
  assert.equal(entry.flags.network, false, `${entry.id}: pure read-only must not use network`);
  assert.equal(entry.flags.rawNovaRisk, false, `${entry.id}: pure read-only must not read raw .nova artifacts`);
  assert.equal(entry.flags.outsideRootRisk, false, `${entry.id}: pure read-only must not allow outside-root access`);
  assert.ok(entry.sourceRefs.length > 0, `${entry.id}: sourceRefs required`);
  assert.ok(entry.rationale.length >= 20, `${entry.id}: rationale required`);
}

function assertDangerousInvariant(entry: SafetyMatrixEntry): void {
  assert.equal(entry.orchestratorReadOnlyCompatible, false, `${entry.id}: dangerous/live/mutating must not be orchestrator-compatible`);
  assert.notEqual(entry.classification, 'pure-read-only', `${entry.id}: dangerous/live/mutating cannot be pure-read-only`);
}

function assertMatrixSemantics(): void {
  for (const entry of readOnlySafetyMatrix) {
    assert.ok(entry.id && entry.label && entry.commandOrTool, `${entry.id}: id/label/command required`);
    assert.ok(entry.sourceRefs.length > 0, `${entry.id}: sourceRefs required`);
    if (isPureReadOnly(entry)) assertPureReadOnlyInvariant(entry);
    if (isDangerousOrMutating(entry)) assertDangerousInvariant(entry);
  }
}

function assertKnownDangerousNotReadOnly(): void {
  const dangerousIds = [
    'cli.prompt-interactive',
    'cli.batch.live',
    'cli.heartbeat.tick.live',
    'cli.config.init',
    'cli.eval.runner',
    'script.dev-start',
    'script.build-prepack',
    'script.eval-mock',
    'script.publish-pack-live',
    'tool.write-file',
    'tool.bash',
    'tool.web-search',
    'tool.goal-todo-skill',
    'category.daemon-autonomy',
    'category.provider-live',
    'category.release-network',
    'category.sensitive-artifacts',
  ];
  for (const id of dangerousIds) assertDangerousInvariant(entryById(id));
}

function assertSafeRepresentativeEntries(): void {
  for (const id of ['cli.help', 'cli.version', 'cli.providers.list', 'cli.eval.list', 'cli.heartbeat.status', 'script.typecheck', 'tool.git']) {
    assertPureReadOnlyInvariant(entryById(id));
  }

  for (const id of ['cli.batch.dry-run', 'cli.heartbeat.tick.dry-run', 'script.smokes.safe']) {
    const entry = entryById(id);
    assert.equal(entry.orchestratorReadOnlyCompatible, true, `${id}: offline smoke/dry-run should remain compatible`);
    assert.notEqual(entry.classification, 'pure-read-only', `${id}: metadata-writing dry-runs must not be pure-read-only`);
    assert.equal(entry.flags.provider, false, `${id}: offline smoke/dry-run must not invoke provider`);
    assert.equal(entry.flags.network, false, `${id}: offline smoke/dry-run must not use network`);
  }
}

function main(): void {
  assertRequiredCoverage();
  assertMatrixSemantics();
  assertKnownDangerousNotReadOnly();
  assertSafeRepresentativeEntries();

  const pureReadOnlyCount = readOnlySafetyMatrix.filter((entry) => entry.classification === 'pure-read-only').length;
  const blockedCount = readOnlySafetyMatrix.filter((entry) => isDangerousOrMutating(entry)).length;
  console.log(`security:readonly-audit passed entries=${readOnlySafetyMatrix.length} pureReadOnly=${pureReadOnlyCount} dangerousOrMutating=${blockedCount}`);
}

try {
  main();
} catch (err) {
  console.error('security:readonly-audit failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
