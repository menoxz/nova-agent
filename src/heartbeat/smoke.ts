#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { projectConfigPath } from '../config/project.js';
import { HeartbeatStore, runHeartbeatDryRunTick } from './index.js';

const repoRoot = process.cwd();
const indexPath = resolve(repoRoot, 'src/index.ts');
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
const SYNTHETIC_SECRET = 'sk-heartbeatHardeningToken1234567890';

function runNova(args: string[], cwd: string) {
  return spawnSync(process.execPath, ['--import', tsxLoader, indexPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', NOVA_ENABLE_WRITE_TOOLS: '' },
  });
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-heartbeat-smoke-'));
  try {
    const noConfig = await runHeartbeatDryRunTick({ projectRoot: root });
    assert.equal(noConfig.config.enabled, false, 'heartbeat defaults disabled');
    assert.equal(noConfig.safety.llmInvoked, false, 'dry-run does not invoke LLM');
    assert.equal(noConfig.safety.toolsInvoked, false, 'dry-run does not invoke tools');
    assert.equal(noConfig.counts.total, 0, 'missing config has no tasks');
    assert.equal(await exists(new HeartbeatStore(root).paths.lock), false, 'lock cleaned after successful direct tick');

    await mkdir(join(root, '.nova'), { recursive: true });
    await writeFile(projectConfigPath(root), JSON.stringify({
      schemaVersion: 1,
      heartbeat: {
        enabled: true,
        tasks: [
          { id: 'inspect-docs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } },
          { id: 'manual-eval', enabled: true, kind: 'eval', action: 'eval', schedule: { type: 'manual' } },
          { id: 'danger-shell', kind: 'shell', action: 'shell', schedule: { type: 'interval', everyMinutes: 5 } },
          { id: 'unknown-action', kind: 'maintenance', action: 'network-sync', schedule: { type: 'interval', everyMinutes: 5 } },
        ],
      },
    }, null, 2), 'utf-8');

    const tick = runNova(['heartbeat', 'tick', '--dry-run'], root);
    assert.equal(tick.status, 0, `heartbeat tick exits 0: ${tick.stderr}`);
    assert.doesNotMatch((tick.stdout ?? '') + (tick.stderr ?? ''), /LLM_API_KEY not set/, 'heartbeat dry-run does not require LLM key');
    const report = JSON.parse(tick.stdout ?? '{}') as Awaited<ReturnType<typeof runHeartbeatDryRunTick>>;
    assert.equal(report.counts.due, 1, 'interval without lastRunAt is due');
    assert.equal(report.counts.skipped, 1, 'manual task is skipped');
    assert.equal(report.counts.blocked, 1, 'dangerous kind is blocked');
    assert.equal(report.counts.needsUserAction, 1, 'unsupported action needs user action');
    assert.match(await readFile(report.paths.markdown, 'utf-8'), /metadata-only-redacted|Metadata/i, 'markdown report is written');
    assert.equal(await exists(new HeartbeatStore(root).paths.lock), false, 'lock cleaned after successful CLI tick');

    const store = new HeartbeatStore(root);
    const state = JSON.parse(await readFile(store.paths.state, 'utf-8'));
    assert.equal(state.lastTickId, report.tickId, 'state records last tick');

    await assert.rejects(
      store.withLock(async () => { throw new Error('controlled failure'); }),
      /controlled failure/,
      'controlled lock failure is propagated',
    );
    assert.equal(await exists(store.paths.lock), false, 'lock cleaned after controlled failure');

    const help = runNova(['heartbeat', '--help'], root);
    assert.equal(help.status, 0, 'heartbeat help exits 0');
    assert.match(help.stdout ?? '', /nova heartbeat tick --dry-run/, 'help documents tick dry-run');

    const validate = runNova(['heartbeat', 'validate'], root);
    assert.equal(validate.status, 0, `validate exits 0: ${validate.stderr}`);
    assert.match(validate.stdout ?? '', /"enabled": true/, 'validate prints heartbeat config');

    const status = runNova(['heartbeat', 'status'], root);
    assert.equal(status.status, 0, `status exits 0: ${status.stderr}`);
    assert.match(status.stdout ?? '', /"lastTickId"/, 'status prints state');

    const tasks = runNova(['heartbeat', 'tasks'], root);
    assert.equal(tasks.status, 0, `tasks exits 0: ${tasks.stderr}`);
    assert.match(tasks.stdout ?? '', /danger-shell/, 'tasks prints blocked task');

    const latest = runNova(['heartbeat', 'report', 'latest'], root);
    assert.equal(latest.status, 0, `latest exits 0: ${latest.stderr}`);
    assert.match(latest.stdout ?? '', new RegExp(report.tickId), 'latest prints last report');

    const unsafeReport = {
      ...report,
      tasks: [{ ...report.tasks[0], id: SYNTHETIC_SECRET, name: SYNTHETIC_SECRET, kind: 'inspection', action: 'inspect', reason: `token=${SYNTHETIC_SECRET}` }],
    };
    await writeFile(report.paths.json, `${JSON.stringify(unsafeReport, null, 2)}\n`, 'utf-8');
    const safeLatest = runNova(['heartbeat', 'report', 'latest'], root);
    assert.equal(safeLatest.status, 0, `latest redaction exits 0: ${safeLatest.stderr}`);
    assert.doesNotMatch((safeLatest.stdout ?? '') + (safeLatest.stderr ?? ''), new RegExp(SYNTHETIC_SECRET, 'g'), 'latest redacts old non-safe report content');

    const secretRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-secret-config-'));
    try {
      await mkdir(join(secretRoot, '.nova'), { recursive: true });
      await writeFile(projectConfigPath(secretRoot), JSON.stringify({ schemaVersion: 1, heartbeat: { enabled: true, tasks: [{ id: SYNTHETIC_SECRET, kind: 'inspection', action: 'inspect', schedule: { type: 'manual' } }] } }, null, 2), 'utf-8');
      const secretValidate = runNova(['heartbeat', 'validate'], secretRoot);
      assert.equal(secretValidate.status, 1, 'secret-like heartbeat config exits 1');
      assert.match((secretValidate.stdout ?? '') + (secretValidate.stderr ?? ''), /secret-like value is not allowed|Invalid Nova project config/, 'secret-like heartbeat config is rejected');
      assert.doesNotMatch((secretValidate.stdout ?? '') + (secretValidate.stderr ?? ''), new RegExp(SYNTHETIC_SECRET, 'g'), 'secret-like heartbeat config does not print raw secret');
    } finally {
      await rm(secretRoot, { recursive: true, force: true });
    }

    const duplicateRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-duplicate-config-'));
    try {
      await mkdir(join(duplicateRoot, '.nova'), { recursive: true });
      await writeFile(projectConfigPath(duplicateRoot), JSON.stringify({ schemaVersion: 1, heartbeat: { enabled: true, tasks: [
        { id: 'duplicate-task', kind: 'inspection', action: 'inspect', schedule: { type: 'manual' } },
        { id: 'duplicate-task', kind: 'maintenance', action: 'maintain', schedule: { type: 'manual' } },
      ] } }, null, 2), 'utf-8');
      const duplicateValidate = runNova(['heartbeat', 'validate'], duplicateRoot);
      assert.equal(duplicateValidate.status, 1, 'duplicate heartbeat task id exits 1');
      assert.match((duplicateValidate.stdout ?? '') + (duplicateValidate.stderr ?? ''), /duplicate heartbeat task id/, 'duplicate heartbeat task id is rejected');
    } finally {
      await rm(duplicateRoot, { recursive: true, force: true });
    }

    const noLatestRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-no-latest-'));
    try {
      const missing = runNova(['heartbeat', 'report', 'latest'], noLatestRoot);
      assert.equal(missing.status, 1, 'missing latest exits 1');
      assert.match(missing.stderr ?? '', /No heartbeat reports found/, 'missing latest is educational');
    } finally {
      await rm(noLatestRoot, { recursive: true, force: true });
    }

    console.log('heartbeat:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('heartbeat:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
