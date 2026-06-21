#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { loadBatchItems, parseJsonBatch, parseTxtBatch } from './parser.js';

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

  const root = await mkdtemp(join(tmpdir(), 'nova-batch-smoke-'));
  try {
    const txtPath = join(root, 'prompts.txt');
    const jsonPath = join(root, 'prompts.json');
    await writeFile(txtPath, 'hello\n', 'utf-8');
    await writeFile(jsonPath, JSON.stringify([{ id: 'json-1', prompt: 'hello json' }]), 'utf-8');
    assert.equal((await loadBatchItems(txtPath)).items.length, 1, 'loads .txt file');
    assert.equal((await loadBatchItems(jsonPath)).items[0]?.id, 'json-1', 'loads .json file');
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

  console.log('batch:smoke passed');
}

main().catch((err) => {
  console.error('batch:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
