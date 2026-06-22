#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { EvalReport, EvalScenarioResult } from './types.js';

const repoRoot = process.cwd();
const indexPath = resolve(repoRoot, 'src/index.ts');
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const SECRET = 'sk-sloSmokeSecret1234567890';
const RAW_ACTUAL = `raw checks actual ${SECRET}`;

function runNova(args: string[], cwd: string) {
  return spawnSync(process.execPath, ['--import', tsxLoader, indexPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', NOVA_ENABLE_WRITE_TOOLS: '' },
  });
}

async function writeReport(root: string, report: EvalReport): Promise<void> {
  await writeReportAt(root, report.evalRunId, report);
}

async function writeReportAt(root: string, evalRunId: string, report: EvalReport): Promise<void> {
  const dir = join(root, '.nova', 'evals', evalRunId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}

function passedScenario(id = 'stable-pass'): EvalScenarioResult {
  return {
    scenarioId: id,
    name: id === 'old-failure' ? 'Old failure recovered' : 'Stable pass',
    status: 'passed',
    durationMs: 1,
    metrics: { stepCount: 1, toolCallCount: 1, uniqueTools: ['read_file'], finalAnswerChars: 10 },
    checks: [{ name: 'ok', passed: true, actual: RAW_ACTUAL }],
    finalAnswer: `raw final answer ${SECRET}`,
  };
}

function failedScenario(id = 'new-failure', status: 'failed' | 'error' = 'failed'): EvalScenarioResult {
  return {
    scenarioId: id,
    name: id === 'old-failure' ? 'Old failure recovered' : id === 'runner-error' ? 'Runner error' : 'New failure',
    status,
    durationMs: 2,
    metrics: { stepCount: 2, toolCallCount: status === 'error' ? 0 : 4, uniqueTools: ['grep'], finalAnswerChars: 20 },
    checks: [{ name: 'required_text', passed: false, expected: 'safe', actual: RAW_ACTUAL }],
    error: `token=${SECRET}`,
    finalAnswer: `unsafe final answer ${SECRET}`,
  };
}

function fixture(evalRunId: string, results: EvalScenarioResult[], endedAt: string): EvalReport {
  const total = results.length;
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const errors = results.filter((result) => result.status === 'error').length;
  const maxScenarioToolCalls = Math.max(0, ...results.map((result) => result.metrics.toolCallCount));
  const averageToolCalls = total ? Number((results.reduce((sum, result) => sum + result.metrics.toolCallCount, 0) / total).toFixed(4)) : 0;
  return {
    schemaVersion: 2,
    evalRunId,
    mode: 'mock',
    suite: 'eval-slo-dashboard-v1',
    startedAt: endedAt.replace('00Z', '59Z'),
    endedAt,
    summary: { total, passed, failed, errors, passRate: total ? Number((passed / total).toFixed(4)) : 0, durationMs: 42, averageToolCalls, averageSteps: 2 },
    gates: {
      passed: failed === 0 && errors === 0 && averageToolCalls <= 3 && maxScenarioToolCalls <= 5,
      config: { minPassRate: 1, maxErrors: 0, maxAverageToolCalls: 3, maxScenarioToolCalls: 5 },
      results: [
        { name: 'min_pass_rate', passed: failed === 0 && errors === 0, expected: '>= 1', actual: total ? passed / total : 0 },
        { name: 'max_errors', passed: errors === 0, expected: '<= 0', actual: errors },
        { name: 'max_average_tool_calls', passed: averageToolCalls <= 3, expected: '<= 3', actual: averageToolCalls },
        { name: 'max_scenario_tool_calls', passed: maxScenarioToolCalls <= 5, expected: '<= 5', actual: maxScenarioToolCalls },
      ],
    },
    results,
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-eval-slo-smoke-'));
  try {
    await writeReport(root, fixture('run-previous', [passedScenario(), passedScenario('previous-pass-2'), passedScenario('previous-pass-3'), failedScenario('old-failure')], '2026-01-01T00:00:00.000Z'));
    await writeReport(root, fixture('run-current', [passedScenario(), passedScenario('old-failure'), failedScenario('new-failure'), failedScenario('runner-error', 'error')], '2026-01-02T00:00:00.000Z'));
    await writeReportAt(root, 'mismatch-run', fixture('different-run-id', [passedScenario()], '2026-01-03T00:00:00.000Z'));

    const latestJson = runNova(['eval', 'dashboard', 'latest', '--json'], root);
    assert.equal(latestJson.status, 0, `dashboard latest --json exits 0: ${latestJson.stderr}`);
    assert.doesNotMatch(latestJson.stdout + latestJson.stderr, /LLM_API_KEY not set/, 'dashboard does not require LLM_API_KEY');
    assert.doesNotMatch(latestJson.stdout + latestJson.stderr, new RegExp(SECRET, 'g'), 'dashboard JSON redacts fake secret');
    assert.doesNotMatch(latestJson.stdout, /finalAnswer|"checks"/, 'dashboard JSON excludes finalAnswer and raw checks');
    assert.doesNotMatch(latestJson.stdout, new RegExp(RAW_ACTUAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'dashboard JSON excludes raw checks.actual text');
    const dashboard = JSON.parse(latestJson.stdout) as { schemaVersion: number; run: { evalRunId: string }; readiness: { status: string; reasons: string[] }; toolCallBudgets: { configured: unknown[] } };
    assert.equal(dashboard.schemaVersion, 1, 'dashboard schema version is stable');
    assert.equal(dashboard.run.evalRunId, 'run-current', 'latest resolves current run');
    assert.equal(dashboard.readiness.status, 'not_ready', 'current failures make run not ready');
    assert.ok(dashboard.toolCallBudgets.configured.length >= 2, 'tool-call budgets are modeled when configured');

    const runIdText = runNova(['eval', 'dashboard', 'run-current'], root);
    assert.equal(runIdText.status, 0, `dashboard <runId> exits 0: ${runIdText.stderr}`);
    assert.match(runIdText.stdout, /Eval SLO Dashboard run-current/, 'human dashboard renders');
    assert.match(runIdText.stdout, /Readiness: not_ready/, 'human dashboard includes readiness');
    assert.doesNotMatch(runIdText.stdout + runIdText.stderr, new RegExp(SECRET, 'g'), 'human dashboard redacts fake secret');

    const aliasJson = runNova(['eval', 'slo', 'run-current', '--json', '--previous', 'run-previous'], root);
    assert.equal(aliasJson.status, 0, `slo alias with previous exits 0: ${aliasJson.stderr}`);
    const withRegression = JSON.parse(aliasJson.stdout) as { regression: { status: string; deltas: { passRate: number; errors: number }; newlyFailed: Array<{ scenarioId: string }>; recovered: Array<{ scenarioId: string }> }; readiness: { reasons: string[] } };
    assert.equal(withRegression.regression.status, 'regressed', 'regression is detected');
    assert.equal(withRegression.regression.deltas.passRate, -0.25, 'pass-rate regression delta is stable');
    assert.equal(withRegression.regression.deltas.errors, 1, 'error increase is detected');
    assert.deepEqual(withRegression.regression.newlyFailed.map((item) => item.scenarioId), ['new-failure', 'runner-error'], 'new failures are detected');
    assert.deepEqual(withRegression.regression.recovered.map((item) => item.scenarioId), ['old-failure'], 'recovered scenarios are detected');
    assert.ok(withRegression.readiness.reasons.includes('pass rate regressed'), 'readiness records pass-rate regression');
    assert.ok(withRegression.readiness.reasons.includes('error count increased'), 'readiness records error regression');
    assert.ok(withRegression.readiness.reasons.includes('new scenario failures detected'), 'readiness records new failures');
    assert.doesNotMatch(aliasJson.stdout + aliasJson.stderr, new RegExp(SECRET, 'g'), 'regression dashboard output is safe');

    const mismatch = runNova(['eval', 'dashboard', 'mismatch-run'], root);
    assert.equal(mismatch.status, 1, 'evalRunId mismatch exits 1');
    assert.match(mismatch.stderr, /Eval report id mismatch/, 'evalRunId mismatch is rejected');

    const traversal = runNova(['eval', 'dashboard', '..'], root);
    assert.equal(traversal.status, 1, 'traversal run id exits 1');
    assert.match(traversal.stderr, /Invalid eval run id/, 'traversal rejected');
    assert.doesNotMatch(traversal.stderr + traversal.stdout, /LLM_API_KEY not set/, 'traversal does not reach LLM key check');

    const missingPrevious = runNova(['eval', 'dashboard', 'run-current', '--previous', 'missing-run'], root);
    assert.equal(missingPrevious.status, 1, 'missing previous exits 1');
    assert.match(missingPrevious.stderr, /eval report\.json|no such file|cannot find/i, 'missing previous fails safely');

    const emptyRoot = await mkdtemp(join(tmpdir(), 'nova-eval-slo-empty-'));
    try {
      const emptyLatest = runNova(['eval', 'dashboard', 'latest'], emptyRoot);
      assert.equal(emptyLatest.status, 1, 'no-report dashboard latest exits 1');
      assert.match(emptyLatest.stderr, /No eval reports found/, 'no-report latest is explicit');
      assert.doesNotMatch(emptyLatest.stderr + emptyLatest.stdout, /LLM_API_KEY not set/, 'no-report latest does not reach LLM key check');
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }

    console.log('eval:slo-smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('eval:slo-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
