#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { dryRunBatch, loadBatchItems, parseJsonBatch, parseTxtBatch, planBatchItems, renderBatchMarkdownReport } from './index.js';

const SYNTHETIC_SECRET = 'sk-batchSmokeSecret1234567890';

function runNova(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
  });
}

async function main(): Promise<void> {
  const txtItems = parseTxtBatch('\n# ignored\nfirst prompt\n// ignored too\nsecond prompt\n');
  assert.deepEqual(txtItems.map((item) => item.id), ['line-3', 'line-5'], '.txt ids use source lines');
  assert.deepEqual(txtItems.map((item) => item.prompt), ['first prompt', 'second prompt'], '.txt prompts parsed');

  const jsonItems = parseJsonBatch(JSON.stringify([{ id: 'task-1', prompt: 'Do one thing' }, { id: 'task_2', prompt: 'Do another thing' }]));
  assert.deepEqual(jsonItems.map((item) => item.id), ['task-1', 'task_2'], '.json ids parsed');
  assert.throws(() => parseJsonBatch('{'), /Invalid batch JSON/, 'invalid json explained');
  assert.throws(() => parseJsonBatch(JSON.stringify([{ id: 'bad id', prompt: 'x' }])), /unsafe id/, 'unsafe id explained');
  assert.throws(() => parseJsonBatch(JSON.stringify([{ id: 'dupe', prompt: 'x' }, { id: 'dupe', prompt: 'y' }])), /duplicate id/, 'duplicate id explained');
  assert.throws(() => parseTxtBatch(' \n# ignored\n// ignored\n'), /contains no prompts/, 'empty txt is rejected');
  assert.throws(() => parseJsonBatch('[]'), /contains no items/, 'empty json is rejected');
  assert.throws(() => planBatchItems(jsonItems, { onlyIds: ['missing'] }), /Unknown --only id/, 'unknown --only is rejected');
  assert.throws(() => planBatchItems(jsonItems, { fromId: 'missing' }), /Unknown --from id/, 'unknown --from is rejected');
  assert.throws(() => planBatchItems(jsonItems, { limit: 0 }), /matched no items|limit/, 'invalid direct limit does not select silently');

  const root = await mkdtemp(join(tmpdir(), 'nova-batch-smoke-'));
  try {
    const txtPath = join(root, 'prompts.txt');
    const jsonPath = join(root, 'prompts.json');
    const mdPath = join(root, 'prompts.md');
    await writeFile(txtPath, 'hello\n', 'utf-8');
    await writeFile(jsonPath, JSON.stringify([{ id: 'json-1', prompt: 'hello json' }]), 'utf-8');
    await writeFile(mdPath, '# not supported\n', 'utf-8');
    assert.equal((await loadBatchItems(txtPath)).items.length, 1, 'loads .txt file');
    assert.equal((await loadBatchItems(jsonPath)).items[0]?.id, 'json-1', 'loads .json file');
    await assert.rejects(() => loadBatchItems(mdPath), /Unsupported batch file extension/, 'unsupported extension is rejected');

    const plan = planBatchItems(jsonItems, { onlyIds: ['task_2'], fromId: 'task-1', limit: 1 });
    assert.deepEqual(plan.selected.map((item) => item.id), ['task_2'], 'filters select expected id');
    assert.equal(plan.skippedBefore.length, 1, 'filters record skipped items');

    await mkdir('tmp', { recursive: true });
    const reportPath = join('tmp', 'batch-dry-smoke-report.json');
    const reportMarkdownPath = join('tmp', 'batch-dry-smoke-report.md');
    const dry = await dryRunBatch(jsonPath, { reportPath, reportMarkdownPath, limit: 1, ci: true });
    assert.equal(dry.options.dryRun, true, 'dry-run report marks dry run');
    assert.equal(dry.options.ci, true, 'dry-run report records ci option');
    assert.equal(dry.options.reportMarkdown, true, 'dry-run report records markdown option');
    assert.equal(dry.reportMarkdownPath?.endsWith('batch-dry-smoke-report.md'), true, 'dry-run report includes markdown path');
    assert.equal(dry.counts.total, 1, 'dry-run reports selected total');
    assert.equal(dry.items[0]?.skipReason, 'Dry run: item validated but not executed.', 'dry-run item explains no execution');
    const markdown = await readFile(reportMarkdownPath, 'utf-8');
    assert.match(markdown, /# Nova Batch Report/, 'markdown report has title');
    assert.match(markdown, /## Summary/, 'markdown report has summary');
    assert.match(markdown, /\| ID \| Status \| Duration \| Tokens \| Cost \| Run \| Event log \|/, 'markdown report has items table');
    assert.match(markdown, /Dry run: item validated but not executed\./, 'markdown report includes dry-run detail');

    const unsafeJson = join(root, 'unsafe-prompts.json');
    await writeFile(unsafeJson, JSON.stringify([{ id: 'pipe-task', prompt: `Prompt with | pipe, \`inline\`, fence \`\`\` and token=${SYNTHETIC_SECRET}` }]), 'utf-8');
    const unsafeMarkdown = join('tmp', 'batch-dry-smoke-unsafe.md');
    const unsafe = await dryRunBatch(unsafeJson, { reportMarkdownPath: unsafeMarkdown, ci: true });
    assert.doesNotMatch(unsafe.items[0]?.promptPreview ?? '', new RegExp(SYNTHETIC_SECRET, 'g'), 'prompt preview redacts secrets');
    const unsafeMarkdownText = await readFile(unsafeMarkdown, 'utf-8');
    assert.doesNotMatch(unsafeMarkdownText, new RegExp(SYNTHETIC_SECRET, 'g'), 'markdown prompt preview redacts secrets');
    assert.match(unsafeMarkdownText, /token=<redacted>/, 'markdown keeps safe redaction marker');
    assert.match(unsafeMarkdownText, /\| pipe/, 'markdown preserves pipe inside fenced prompt preview');
    assert.match(unsafeMarkdownText, /``\u200b`/, 'markdown breaks nested triple backticks inside fenced prompt preview');

    const escaped = renderBatchMarkdownReport({ ...dry, items: [{ ...dry.items[0]!, id: 'id|with`tick', skipReason: 'pipe | and `tick`' }] });
    assert.match(escaped, /id\\\|with\\`tick/, 'markdown table escapes pipe and backtick in item id');

    await assert.rejects(() => dryRunBatch(jsonPath, { reportPath: join(process.cwd(), '..', 'batch-outside.json') }), /Batch report path/, 'report path outside workspace is rejected');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const help = runNova(['batch', '--help']);
  assert.equal(help.status, 0, 'batch help exits 0');
  assert.match(help.stdout ?? '', /nova batch <file>/, 'batch help includes usage');
  assert.doesNotMatch((help.stderr ?? '') + (help.stdout ?? ''), /LLM_API_KEY not set/, 'batch help does not require LLM key');

  const missing = runNova(['batch']);
  assert.equal(missing.status, 1, 'missing batch file exits 1');
  assert.match(missing.stderr ?? '', /Missing argument\. Usage: nova batch <file>/, 'missing batch file explained');
  assert.doesNotMatch((missing.stderr ?? '') + (missing.stdout ?? ''), /LLM_API_KEY not set/, 'missing batch file does not reach LLM key check');

  const cliRoot = await mkdtemp(join(tmpdir(), 'nova-batch-cli-smoke-'));
  try {
    const cliJson = join(cliRoot, 'cli-prompts.json');
    await mkdir('tmp', { recursive: true });
    const cliReport = join('tmp', 'batch-cli-dry-smoke-report.json');
    const cliMarkdown = join('tmp', 'batch-cli-dry-smoke-report.md');
    await writeFile(cliJson, JSON.stringify([{ id: 'a', prompt: 'A' }, { id: 'b', prompt: 'B' }, { id: 'c', prompt: 'C' }]), 'utf-8');
    const dryRun = runNova(['batch', cliJson, '--dry-run', '--from', 'b', '--limit', '1', '--report', cliReport, '--report-md', cliMarkdown]);
    assert.equal(dryRun.status, 0, `dry-run exits 0: ${dryRun.stderr}`);
    assert.match(dryRun.stdout ?? '', /Batch dry-run/, 'dry-run prints summary');
    assert.match(dryRun.stdout ?? '', /✓ b/, 'dry-run prints selected id');
    assert.match(dryRun.stdout ?? '', /Markdown report:/, 'dry-run prints markdown report path');
    assert.doesNotMatch((dryRun.stderr ?? '') + (dryRun.stdout ?? ''), /LLM_API_KEY not set/, 'dry-run does not require LLM key');

    const ciRun = runNova(['batch', cliJson, '--dry-run', '--ci', '--from', 'b', '--limit', '1', '--report-md', cliMarkdown]);
    assert.equal(ciRun.status, 0, `dry-run ci exits 0: ${ciRun.stderr}`);
    assert.match(ciRun.stdout ?? '', /BATCH_SUMMARY status=completed total=3 success=0 error=0 skipped=3/, 'ci prints stable summary');
    assert.match(ciRun.stdout ?? '', /BATCH_REPORT_JSON path=/, 'ci prints json report path');
    assert.match(ciRun.stdout ?? '', /BATCH_REPORT_MD path=/, 'ci prints markdown report path');
    assert.match(ciRun.stdout ?? '', /BATCH_ITEM id=b status=skipped/, 'ci prints selected item line');
    assert.doesNotMatch((ciRun.stderr ?? '') + (ciRun.stdout ?? ''), /LLM_API_KEY not set/, 'ci dry-run does not require LLM key');

    const badLimit = runNova(['batch', cliJson, '--dry-run', '--limit', '0']);
    assert.equal(badLimit.status, 1, 'invalid --limit exits 1');
    assert.match(badLimit.stderr ?? '', /--limit must be a positive integer/, 'invalid --limit is explained');

    const unknownOnly = runNova(['batch', cliJson, '--dry-run', '--only', 'missing']);
    assert.equal(unknownOnly.status, 1, 'unknown --only exits 1');
    assert.match(unknownOnly.stderr ?? '', /Unknown --only id/, 'unknown --only is explained');

    const unknownFrom = runNova(['batch', cliJson, '--dry-run', '--from', 'missing']);
    assert.equal(unknownFrom.status, 1, 'unknown --from exits 1');
    assert.match(unknownFrom.stderr ?? '', /Unknown --from id/, 'unknown --from is explained');

    const outsideReport = runNova(['batch', cliJson, '--dry-run', '--report', join(process.cwd(), '..', 'batch-outside.json')]);
    assert.equal(outsideReport.status, 1, 'outside report path exits 1');
    assert.match(outsideReport.stderr ?? '', /Batch report path/, 'outside report path is rejected');
  } finally {
    await rm(cliRoot, { recursive: true, force: true });
  }

  console.log('batch:smoke passed');
}

main().catch((err) => {
  console.error('batch:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
