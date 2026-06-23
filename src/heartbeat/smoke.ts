#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { projectConfigPath } from '../config/project.js';
import {
  buildAutomationManifest,
  defaultTickEveryMinutes,
  HeartbeatScheduleError,
  HeartbeatStore,
  isInQuietHours,
  nextIntervalOccurrence,
  parseDurationMinutes,
  planHeartbeatTask,
  projectHeartbeatPlan,
  projectIntervalOccurrences,
  renderHeartbeatMarkdown,
  resolveHeartbeatConfig,
  runHeartbeatDryRunTick,
  validateTimezone,
} from './index.js';
import type { HeartbeatPlanReport, HeartbeatQuietWindow, HeartbeatState, HeartbeatTaskConfig, HeartbeatTickReport } from './index.js';

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
    const now = new Date('2026-01-02T00:00:00.000Z');
    const task: HeartbeatTaskConfig = { id: 'boundary', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } };
    const heartbeatState = (lastRunAt?: string): HeartbeatState => ({ schemaVersion: 1, heartbeatId: 'heartbeat_smoke', enabled: true, updatedAt: now.toISOString(), tasks: lastRunAt ? { boundary: { lastRunAt } } : {} });
    assert.equal(planHeartbeatTask(task, heartbeatState('2026-01-01T23:00:00.000Z'), true, now).status, 'due', 'schedule boundary is due when nextDueAt equals now');
    assert.equal(planHeartbeatTask(task, heartbeatState('2026-01-01T23:00:01.000Z'), true, now).status, 'skipped', 'future nextDueAt is skipped');
    assert.equal(planHeartbeatTask(task, heartbeatState('not-a-date'), true, now).status, 'due', 'invalid stored lastRunAt is due for review');
    assert.equal(planHeartbeatTask({ ...task, schedule: { type: 'interval', everyMinutes: 0 } }, heartbeatState(), true, now).status, 'blocked', 'invalid interval is blocked');
    assert.equal(planHeartbeatTask(task, heartbeatState('2026-01-02T01:00:00.000Z'), true, now).status, 'skipped', 'future lastRunAt is skipped');

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

    await mkdir(join(root, '.nova', 'heartbeat', 'locks'), { recursive: true });
    await writeFile(store.paths.lock, 'pre-existing lock', 'utf-8');
    await assert.rejects(() => runHeartbeatDryRunTick({ projectRoot: root, config: { enabled: true, tasks: [task] } }), /already in progress/, 'pre-existing lock rejects tick with EEXIST');
    await rm(store.paths.lock, { force: true });

    const markdownReport: HeartbeatTickReport = {
      ...report,
      tasks: [{ ...report.tasks[0]!, id: 'task|pipe', reason: 'line one | pipe\nline two' }],
    };
    const markdownText = renderHeartbeatMarkdown(markdownReport);
    assert.match(markdownText, /task\\\\\|pipe/, 'heartbeat markdown escapes pipe in table cell');
    assert.doesNotMatch(markdownText, /line one \| pipe\nline two/, 'heartbeat markdown flattens table-cell newlines');

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

    // §2.1 schedule.ts — deterministic duration / interval / quiet-hours math.
    assert.equal(parseDurationMinutes('90m'), 90, 'parseDurationMinutes 90m');
    assert.equal(parseDurationMinutes('24h'), 1440, 'parseDurationMinutes 24h');
    assert.equal(parseDurationMinutes('7d'), 10080, 'parseDurationMinutes 7d');
    assert.equal(parseDurationMinutes('45'), 45, 'parseDurationMinutes bare minutes');
    for (const bad of ['5w', '-3h', 'h', '']) {
      assert.throws(() => parseDurationMinutes(bad), HeartbeatScheduleError, `parseDurationMinutes rejects ${JSON.stringify(bad)}`);
    }
    assert.equal(
      new Date(nextIntervalOccurrence(Date.parse('2026-01-02T00:07:00.000Z'), 15)).toISOString(),
      '2026-01-02T00:15:00.000Z',
      'nextIntervalOccurrence snaps to the 15-minute grid',
    );
    assert.equal(
      new Date(nextIntervalOccurrence(Date.parse('2026-01-02T00:07:00.000Z'), 60, Date.parse('2026-01-02T00:00:00.000Z'))).toISOString(),
      '2026-01-02T01:00:00.000Z',
      'nextIntervalOccurrence honours an hourly anchor',
    );
    const hourly = projectIntervalOccurrences({ nowMs: now.getTime(), horizonMin: 180, everyMin: 60, anchorMs: now.getTime(), maxPerTask: 5 });
    assert.deepEqual(
      hourly.map((ms) => new Date(ms).toISOString()),
      ['2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z', '2026-01-02T02:00:00.000Z', '2026-01-02T03:00:00.000Z'],
      'projectIntervalOccurrences yields the inclusive hourly grid',
    );
    assert.equal(
      projectIntervalOccurrences({ nowMs: now.getTime(), horizonMin: 1440, everyMin: 1, maxPerTask: 10 }).length,
      10,
      'projectIntervalOccurrences caps at maxPerTask',
    );
    const quietWindows: HeartbeatQuietWindow[] = [{ start: '01:00', end: '02:00' }];
    assert.ok(isInQuietHours(Date.parse('2026-01-02T01:30:00.000Z'), quietWindows, 'UTC'), 'isInQuietHours matches inside a window');
    assert.equal(isInQuietHours(Date.parse('2026-01-02T02:00:00.000Z'), quietWindows, 'UTC'), null, 'isInQuietHours excludes the window end');
    assert.ok(isInQuietHours(Date.parse('2026-01-02T23:30:00.000Z'), [{ start: '22:00', end: '06:00' }], 'UTC'), 'isInQuietHours wraps past midnight');
    assert.equal(validateTimezone('UTC'), true, 'validateTimezone accepts UTC');
    assert.equal(validateTimezone('Europe/Paris'), true, 'validateTimezone accepts an IANA zone');
    assert.equal(validateTimezone('Not/AZone'), false, 'validateTimezone rejects junk');

    // §2.2 planner.ts — a disabled heartbeat still projects; quiet hours suppress.
    const planTask: HeartbeatTaskConfig = { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60, anchor: now.toISOString() } };
    const disabledPlan = projectHeartbeatPlan({ config: { enabled: false, tasks: [planTask] }, state: heartbeatState(), nowMs: now.getTime(), horizonMinutes: 180, maxPerTask: 5, heartbeatId: 'heartbeat_smoke' });
    assert.equal(disabledPlan.preview, true, 'disabled heartbeat plan is a preview');
    assert.equal(disabledPlan.heartbeatEnabled, false, 'disabled heartbeat plan reports disabled');
    assert.equal(disabledPlan.tasks.length, 1, 'plan projects the single task');
    assert.equal(disabledPlan.tasks[0]!.status, 'projected', 'enabled interval task still projects while heartbeat is disabled');
    assert.deepEqual(
      disabledPlan.tasks[0]!.occurrences.map((occ) => occ.at),
      ['2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z', '2026-01-02T02:00:00.000Z', '2026-01-02T03:00:00.000Z'],
      'plan occurrences land on the hourly grid',
    );
    assert.ok(disabledPlan.tasks[0]!.occurrences.every((occ) => occ.classification === 'would_run'), 'with no quiet window every occurrence would_run');
    assert.equal(disabledPlan.safety.schedulerInstalled, false, 'plan installs no scheduler');
    assert.equal(disabledPlan.safety.autonomousActionsExecuted, false, 'plan executes nothing');
    const quietPlan = projectHeartbeatPlan({ config: { enabled: true, timezone: 'UTC', quietHours: [{ start: '00:00', end: '06:00' }], tasks: [planTask] }, state: heartbeatState(), nowMs: now.getTime(), horizonMinutes: 180, maxPerTask: 5, heartbeatId: 'heartbeat_smoke' });
    assert.ok(quietPlan.tasks[0]!.occurrences.every((occ) => occ.classification === 'quiet_hours'), 'a covering quiet window suppresses every occurrence');
    assert.equal(quietPlan.tasks[0]!.firstDueAt, undefined, 'a fully-suppressed task has no firstDueAt');
    assert.equal(quietPlan.counts.quietHours, 4, 'plan counts quiet-hours occurrences');

    // §2.3 automation.ts — inert manifests with redacted placeholders + default cadence.
    const cronEvery = buildAutomationManifest({ target: 'cron', tickEveryMinutes: 15, timezone: 'UTC' });
    assert.equal(cronEvery.installed, false, 'cron manifest is not installed');
    assert.equal(cronEvery.invokes, 'nova heartbeat tick --dry-run', 'cron manifest invokes only the dry run');
    assert.match(cronEvery.body, /\*\/15 \* \* \* \*/, 'cron interval spec is rendered');
    assert.match(cronEvery.body, /Nova does not schedule itself/, 'cron manifest carries the banner');
    const cronAt = buildAutomationManifest({ target: 'cron', tickAt: '02:30', timezone: 'UTC' });
    assert.match(cronAt.body, /^30 2 \* \* \* /m, 'cron daily spec is rendered');
    const systemdManifest = buildAutomationManifest({ target: 'systemd', tickEveryMinutes: 30, timezone: 'UTC' });
    assert.match(systemdManifest.body, /\[Timer\]/, 'systemd manifest has a [Timer] section');
    assert.match(systemdManifest.body, /ExecStart=<NOVA_BIN> heartbeat tick --dry-run/, 'systemd ExecStart uses the nova-bin placeholder');
    assert.match(systemdManifest.body, /WorkingDirectory=<PROJECT_DIR>/, 'systemd WorkingDirectory uses the project placeholder');
    const windowsManifest = buildAutomationManifest({ target: 'windows-task', tickEveryMinutes: 60, timezone: 'UTC' });
    assert.match(windowsManifest.body, /schtasks \/Create/, 'windows manifest uses schtasks');
    for (const manifest of [cronEvery, cronAt, systemdManifest, windowsManifest]) {
      assert.doesNotMatch(manifest.body, new RegExp(SYNTHETIC_SECRET, 'g'), 'manifest body carries no secret');
      assert.doesNotMatch(manifest.body, /^(?:[A-Za-z]:\\|\/)/m, 'manifest body leaks no absolute path');
      assert.match(manifest.body, /<PROJECT_DIR>/, 'manifest body keeps the project placeholder');
      assert.match(manifest.body, /<NOVA_BIN>/, 'manifest body keeps the nova-bin placeholder');
    }
    assert.equal(
      defaultTickEveryMinutes({ enabled: true, tasks: [{ id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 30 } }] }),
      30,
      'defaultTickEveryMinutes derives from the smallest safe interval',
    );
    assert.equal(defaultTickEveryMinutes(undefined), 15, 'defaultTickEveryMinutes falls back to 15');

    // §2.4 config back-compat — a V1 config resolves with UTC and no quiet hours.
    const v1Resolved = resolveHeartbeatConfig({ enabled: true, tasks: [{ id: 'inspect-docs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } }] });
    assert.equal(v1Resolved.timezone, 'UTC', 'a legacy config defaults to UTC');
    assert.deepEqual(v1Resolved.quietHours, [], 'a legacy config has no quiet hours');

    // §2.5.7 static guard — core modules carry no self-scheduling primitives.
    const forbiddenScheduling = /setInterval|setTimeout|setImmediate|child_process|\.exec\(|spawn\(/;
    for (const moduleRelPath of ['src/heartbeat/schedule.ts', 'src/heartbeat/planner.ts', 'src/heartbeat/automation.ts']) {
      const source = await readFile(resolve(repoRoot, moduleRelPath), 'utf-8');
      assert.doesNotMatch(source, forbiddenScheduling, `${moduleRelPath} contains no scheduling primitive`);
    }

    // §2.5 / §2.6 CLI — plan is read-only + deterministic; automation export is sandboxed.
    const planRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-plan-'));
    try {
      await mkdir(join(planRoot, '.nova'), { recursive: true });
      await writeFile(projectConfigPath(planRoot), JSON.stringify({
        schemaVersion: 1,
        heartbeat: {
          enabled: true,
          timezone: 'UTC',
          tasks: [
            { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60, anchor: '2026-01-02T00:00:00.000Z' } },
          ],
        },
      }, null, 2), 'utf-8');

      const planHelp = runNova(['heartbeat', '--help'], planRoot);
      assert.equal(planHelp.status, 0, 'heartbeat help exits 0');
      assert.match(planHelp.stdout ?? '', /nova heartbeat plan/, 'help documents plan');
      assert.match(planHelp.stdout ?? '', /nova heartbeat tick --dry-run/, 'help still documents tick dry-run');

      const planTick = runNova(['heartbeat', 'tick', '--dry-run'], planRoot);
      assert.equal(planTick.status, 0, `seed tick exits 0: ${planTick.stderr}`);
      const planStore = new HeartbeatStore(planRoot);
      const stateBefore = await readFile(planStore.paths.state);

      const planArgs = ['heartbeat', 'plan', '--now', '2026-01-02T00:00:00.000Z', '--horizon', '3h', '--max', '5', '--json'];
      const plan1 = runNova(planArgs, planRoot);
      assert.equal(plan1.status, 0, `plan exits 0: ${plan1.stderr}`);
      const report1 = JSON.parse(plan1.stdout ?? '{}') as HeartbeatPlanReport;
      assert.equal(report1.tasks.length, 1, 'CLI plan projects one task');
      assert.equal(report1.tasks[0]!.status, 'projected', 'CLI plan task is projected');
      assert.deepEqual(
        report1.tasks[0]!.occurrences.map((occ) => occ.at),
        ['2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z', '2026-01-02T02:00:00.000Z', '2026-01-02T03:00:00.000Z'],
        'CLI plan occurrences match the hourly grid',
      );
      assert.ok(report1.tasks[0]!.occurrences.every((occ) => occ.classification === 'would_run'), 'CLI plan occurrences would_run');
      assert.equal(report1.safety.llmInvoked, false, 'plan does not invoke the LLM');
      assert.equal(report1.safety.toolsInvoked, false, 'plan does not invoke tools');
      assert.equal(report1.safety.autonomousActionsExecuted, false, 'plan executes nothing');
      assert.equal(report1.safety.schedulerInstalled, false, 'plan installs no scheduler');
      assert.equal(await exists(join(planRoot, '.nova', 'heartbeat', report1.paths.json)), true, 'plan persists a json artifact');
      assert.equal(await exists(join(planRoot, '.nova', 'heartbeat', report1.paths.markdown)), true, 'plan persists a markdown artifact');

      const stateAfter1 = await readFile(planStore.paths.state);
      assert.deepEqual(stateAfter1, stateBefore, 'plan does not mutate state.json');

      const plan2 = runNova(planArgs, planRoot);
      assert.equal(plan2.status, 0, `second plan exits 0: ${plan2.stderr}`);
      const report2 = JSON.parse(plan2.stdout ?? '{}') as HeartbeatPlanReport;
      assert.equal(report2.planId, report1.planId, 'plan id is deterministic across runs');
      assert.equal(
        JSON.stringify(report2.tasks[0]!.occurrences),
        JSON.stringify(report1.tasks[0]!.occurrences),
        'plan occurrences are byte-identical across runs',
      );
      const stateAfter2 = await readFile(planStore.paths.state);
      assert.deepEqual(stateAfter2, stateBefore, 're-running plan still does not mutate state.json');

      const stdoutExport = runNova(['heartbeat', 'automation', 'export', '--target', 'cron', '--every', '15m', '--stdout'], planRoot);
      assert.equal(stdoutExport.status, 0, `automation --stdout exits 0: ${stdoutExport.stderr}`);
      assert.match(stdoutExport.stdout ?? '', /\*\/15 \* \* \* \*/, 'stdout export prints the cron spec');
      assert.match(stdoutExport.stdout ?? '', /Nova does not schedule itself/, 'stdout export prints the banner');
      assert.equal(await exists(join(planRoot, '.nova', 'heartbeat', 'automation', 'cron.txt')), false, '--stdout writes no file');

      const fileExport = runNova(['heartbeat', 'automation', 'export', '--target', 'systemd', '--every', '30m'], planRoot);
      assert.equal(fileExport.status, 0, `automation file export exits 0: ${fileExport.stderr}`);
      const systemdPath = join(planRoot, '.nova', 'heartbeat', 'automation', 'systemd.txt');
      assert.equal(await exists(systemdPath), true, 'systemd manifest is written under .nova/heartbeat/automation');
      const systemdBody = await readFile(systemdPath, 'utf-8');
      assert.match(systemdBody, /\[Timer\]/, 'persisted systemd manifest keeps the [Timer] section');
      assert.match(systemdBody, /ExecStart=<NOVA_BIN> heartbeat tick --dry-run/, 'persisted systemd manifest keeps the nova-bin placeholder');
      assert.doesNotMatch(systemdBody, /^(?:[A-Za-z]:\\|\/)/m, 'persisted systemd manifest leaks no absolute path');

      const escape = runNova(['heartbeat', 'automation', 'export', '--target', 'cron', '--every', '15m', '--out', '../escape.txt'], planRoot);
      assert.equal(escape.status, 1, 'an out-of-sandbox --out exits 1');
      assert.match((escape.stdout ?? '') + (escape.stderr ?? ''), /must be a relative path that stays under \.nova\/heartbeat/, 'sandbox escape is rejected with a clear message');
      assert.equal(await exists(join(planRoot, '.nova', 'escape.txt')), false, 'sandbox escape writes no file');
      assert.doesNotMatch((escape.stdout ?? '') + (escape.stderr ?? ''), /[A-Za-z]:\\|\/(?:tmp|Users|home|var)\//, 'sandbox escape error leaks no absolute path');
    } finally {
      await rm(planRoot, { recursive: true, force: true });
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
