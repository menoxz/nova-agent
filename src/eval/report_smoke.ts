#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { EvalReport } from './types.js';

const repoRoot = process.cwd();
const indexPath = resolve(repoRoot, 'src/index.ts');
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const SECRET = 'sk-reportSmokeSecret1234567890';

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

function fixture(evalRunId: string, passed: number, failed: number, errors: number, endedAt: string): EvalReport {
  const total = passed + failed + errors;
  return {
    schemaVersion: 2,
    evalRunId,
    mode: 'mock',
    suite: 'eval-report-trend-v1',
    startedAt: endedAt.replace('00Z', '59Z'),
    endedAt,
    summary: { total, passed, failed, errors, passRate: total ? Number((passed / total).toFixed(4)) : 0, durationMs: 42, averageToolCalls: 1, averageSteps: 2 },
    gates: {
      passed: failed === 0 && errors === 0,
      config: { minPassRate: 1, maxErrors: 0 },
      results: [
        { name: 'min_pass_rate', passed: failed === 0 && errors === 0, expected: '>= 1', actual: total ? passed / total : 0 },
        { name: 'max_errors', passed: errors === 0, expected: '<= 0', actual: errors },
      ],
    },
    results: [
      { scenarioId: 'stable-pass', name: 'Stable pass', status: 'passed', durationMs: 1, metrics: { stepCount: 1, toolCallCount: 0, uniqueTools: [], finalAnswerChars: 10 }, checks: [{ name: 'ok', passed: true, actual: `hidden ${SECRET}` }], finalAnswer: `raw answer ${SECRET}` },
      ...(failed ? [{ scenarioId: 'new-failure', name: 'New failure', status: 'failed' as const, durationMs: 2, metrics: { stepCount: 2, toolCallCount: 1, uniqueTools: ['read_file'], finalAnswerChars: 20 }, checks: [{ name: 'required_text', passed: false, expected: 'safe', actual: `unsafe ${SECRET}` }], error: `token=${SECRET}` }] : []),
      ...(errors ? [{ scenarioId: 'runner-error', name: 'Runner error', status: 'error' as const, durationMs: 3, metrics: { stepCount: 0, toolCallCount: 0, uniqueTools: [], finalAnswerChars: 0 }, checks: [{ name: 'runner_error', passed: false, actual: `secret ${SECRET}` }], error: `api_key=${SECRET}` }] : []),
    ],
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-eval-report-smoke-'));
  try {
    await writeReport(root, fixture('run-previous', 2, 0, 0, '2026-01-01T00:00:00.000Z'));
    const currentReport = fixture('run-current', 1, 1, 1, '2026-01-02T00:00:00.000Z');
    currentReport.gates?.results.push({
      name: 'safe_actual_object',
      passed: false,
      expected: 'object redacted and truncated',
      actual: { token: SECRET, nested: { note: `unsafe ${SECRET}`, long: 'x'.repeat(220) } },
    });
    await writeReport(root, currentReport);
    await mkdir(join(root, '.nova', 'evals', 'missing-report'), { recursive: true });
    await writeFile(join(root, '.nova', 'evals', 'invalid-json', 'report.json'), '{', 'utf-8').catch(async () => {
      await mkdir(join(root, '.nova', 'evals', 'invalid-json'), { recursive: true });
      await writeFile(join(root, '.nova', 'evals', 'invalid-json', 'report.json'), '{', 'utf-8');
    });
    await writeReportAt(root, 'mismatch-run', fixture('different-run-id', 1, 0, 0, '2026-01-03T00:00:00.000Z'));

    const list = runNova(['eval', 'list', '--json'], root);
    assert.equal(list.status, 0, `eval list exits 0: ${list.stderr}`);
    assert.doesNotMatch(list.stdout + list.stderr, /LLM_API_KEY not set/, 'list does not require LLM_API_KEY');
    const listed = JSON.parse(list.stdout) as Array<{ evalRunId: string }>;
    assert.deepEqual(listed.map((item) => item.evalRunId), ['run-current', 'run-previous'], 'list sorts latest first');

    const limited = runNova(['eval', 'list', '--json', '--limit', '1'], root);
    assert.equal(limited.status, 0, `eval list --limit exits 0: ${limited.stderr}`);
    assert.deepEqual((JSON.parse(limited.stdout) as Array<{ evalRunId: string }>).map((item) => item.evalRunId), ['run-current'], '--limit 1 returns one latest valid report and ignores invalid report dirs');

    const latest = runNova(['eval', 'report', 'latest', '--json'], root);
    assert.equal(latest.status, 0, `latest report exits 0: ${latest.stderr}`);
    assert.match(latest.stdout, /run-current/, 'latest resolves current run');
    assert.doesNotMatch(latest.stdout + latest.stderr, new RegExp(SECRET, 'g'), 'report output redacts raw answer/check actual/secret');
    assert.doesNotMatch(latest.stdout, /finalAnswer|"checks"/, 'report output does not expose raw finalAnswer or checks');
    assert.match(latest.stdout, /safe_actual_object/, 'report includes gate actual object metadata');
    assert.match(latest.stdout, /\[REDACTED\]|token/, 'report redacts secret-like fields inside gate actual objects');

    const markdown = runNova(['eval', 'summary', 'latest', '--markdown'], root);
    assert.equal(markdown.status, 0, `summary markdown exits 0: ${markdown.stderr}`);
    assert.match(markdown.stdout, /# Nova Eval Summary/, 'summary prints Markdown');
    assert.doesNotMatch(markdown.stdout + markdown.stderr, new RegExp(SECRET, 'g'), 'summary output is safe');

    const outPath = join(root, 'summary.md');
    const out = runNova(['eval', 'summary', 'run-current', '--out', outPath], root);
    assert.equal(out.status, 0, `summary --out exits 0: ${out.stderr}`);
    assert.match(await readFile(outPath, 'utf-8'), /run\\-current/, 'summary out file written');

    const compare = runNova(['eval', 'compare', 'run-previous', 'run-current', '--json'], root);
    assert.equal(compare.status, 0, `compare exits 0: ${compare.stderr}`);
    const comparison = JSON.parse(compare.stdout) as { deltas: { passRate: number; failed: number; errors: number }; newlyFailed: Array<{ scenarioId: string }>; recovered: unknown[] };
    assert.equal(comparison.deltas.passRate, -0.6667, 'pass-rate delta is stable');
    assert.equal(comparison.deltas.failed, 1, 'failed delta is stable');
    assert.equal(comparison.deltas.errors, 1, 'errors delta is stable');
    assert.deepEqual(comparison.newlyFailed.map((item) => item.scenarioId), ['new-failure', 'runner-error'], 'newly failed scenarios are stable');
    assert.deepEqual(comparison.recovered, [], 'recovered scenarios are stable');
    assert.doesNotMatch(compare.stdout + compare.stderr, new RegExp(SECRET, 'g'), 'compare output is safe');

    const compareMarkdown = runNova(['eval', 'compare', 'run-previous', 'run-current', '--markdown'], root);
    assert.equal(compareMarkdown.status, 0, `compare markdown exits 0: ${compareMarkdown.stderr}`);
    assert.match(compareMarkdown.stdout, /# Nova Eval Compare/, 'compare markdown prints Markdown');
    assert.match(compareMarkdown.stdout, /## Newly failed/, 'compare markdown includes failure sections');
    assert.doesNotMatch(compareMarkdown.stdout + compareMarkdown.stderr, new RegExp(SECRET, 'g'), 'compare markdown output is safe');

    const mismatch = runNova(['eval', 'report', 'mismatch-run'], root);
    assert.equal(mismatch.status, 1, 'evalRunId mismatch exits 1');
    assert.match(mismatch.stderr, /Eval report id mismatch/, 'evalRunId mismatch is rejected');
    assert.doesNotMatch(mismatch.stderr + mismatch.stdout, new RegExp(SECRET, 'g'), 'mismatch error does not leak secrets');

    const traversal = runNova(['eval', 'report', '..'], root);
    assert.equal(traversal.status, 1, 'traversal run id exits 1');
    assert.match(traversal.stderr, /Invalid eval run id/, 'traversal rejected');
    assert.doesNotMatch(traversal.stderr + traversal.stdout, /LLM_API_KEY not set/, 'traversal does not reach LLM key check');

    const blockedOut = runNova(['eval', 'summary', 'run-current', '--out', join(root, '.nova', 'evals', 'run-current', 'summary.md')], root);
    assert.equal(blockedOut.status, 1, '--out under .nova/evals is rejected');
    assert.match(blockedOut.stderr, /must not write under existing eval reports directory/, '--out rejection is explicit');

    const emptyRoot = await mkdtemp(join(tmpdir(), 'nova-eval-report-empty-'));
    try {
      const emptyList = runNova(['eval', 'list', '--json'], emptyRoot);
      assert.equal(emptyList.status, 0, `empty eval list exits 0: ${emptyList.stderr}`);
      assert.deepEqual(JSON.parse(emptyList.stdout), [], 'no-report root lists no reports');
      const emptyLatest = runNova(['eval', 'report', 'latest'], emptyRoot);
      assert.equal(emptyLatest.status, 1, 'no-report latest exits 1');
      assert.match(emptyLatest.stderr, /No eval reports found/, 'no-report latest is explicit');
      assert.doesNotMatch(emptyLatest.stderr + emptyLatest.stdout, /LLM_API_KEY not set/, 'no-report latest does not reach LLM key check');
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }

    console.log('eval:report-smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('eval:report-smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
