#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { projectConfigPath } from '../config/project.js';
import {
  buildAutomationManifest,
  classifyHeartbeatTaskSafety,
  computePlanId,
  configDigest,
  decideHeartbeatExecution,
  defaultTickEveryMinutes,
  HEARTBEAT_SCHEMA_VERSION,
  heartbeatGateA,
  HeartbeatScheduleError,
  HeartbeatStore,
  heartbeatTaskNeeds,
  isInQuietHours,
  MAX_HORIZON_MINUTES,
  MAX_OCCURRENCES,
  nextIntervalOccurrence,
  parseClockHHMM,
  parseDurationMinutes,
  planHeartbeatTask,
  projectHeartbeatPlan,
  projectIntervalOccurrences,
  renderHeartbeatMarkdown,
  resolveHeartbeatConfig,
  runHeartbeatDryRunTick,
  safeHeartbeatManifest,
  safeHeartbeatPlanReport,
  safeHeartbeatText,
  stableStringify,
  validateTimezone,
} from './index.js';
import type {
  HeartbeatAutomationManifest,
  HeartbeatConfig,
  HeartbeatExecutionDecidedBy,
  HeartbeatExecutionMode,
  HeartbeatPlanReport,
  HeartbeatQuietWindow,
  HeartbeatState,
  HeartbeatTaskConfig,
  HeartbeatTickReport,
  PlanIdInputs,
} from './index.js';

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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-heartbeat-smoke-'));
  try {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const task: HeartbeatTaskConfig = { id: 'boundary', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } };
    const heartbeatState = (lastRunAt?: string): HeartbeatState => ({ schemaVersion: HEARTBEAT_SCHEMA_VERSION, heartbeatId: 'heartbeat_smoke', enabled: true, updatedAt: now.toISOString(), tasks: lastRunAt ? { boundary: { lastRunAt } } : {} });
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

    // §2.5.7 / ADR-002 §D6 static guard — EVERY heartbeat module (this smoke
    // harness excepted) carries no self-scheduling, shell, or execution
    // primitive. Stronger than ADR-001: the whole directory is swept (not a
    // hand-picked trio), and the forbidden set adds child_process, every
    // exec*/spawn* form, `while (true)`, and the gate's own `.decide(` so the
    // pure decision can never wire itself to a runtime.
    const forbiddenExecution = /setInterval|setTimeout|setImmediate|while\s*\(\s*true\s*\)|node:child_process|child_process|\bexecFile\b|\bexecSync\b|\.exec\(|\bspawnSync\b|\bspawn\b|\.decide\(/;
    const heartbeatDir = resolve(repoRoot, 'src/heartbeat');
    const guardedModules = (await readdir(heartbeatDir))
      .filter((name) => name.endsWith('.ts') && name !== 'smoke.ts')
      .sort();
    assert.ok(guardedModules.length >= 12, `static guard sweeps the heartbeat module set (found ${guardedModules.length})`);
    assert.ok(guardedModules.includes('execution_gate.ts'), 'static guard includes the new execution_gate module');
    for (const name of guardedModules) {
      const source = await readFile(join(heartbeatDir, name), 'utf-8');
      assert.doesNotMatch(source, forbiddenExecution, `src/heartbeat/${name} carries no spawn/timer/execute primitive`);
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

      // §4.10 sandbox — an absolute --out and a deep ../.. traversal are rejected with the same message.
      const absOut = resolve(tmpdir(), 'nova-smoke-escape-abs.txt');
      const escapeAbs = runNova(['heartbeat', 'automation', 'export', '--target', 'cron', '--every', '15m', '--out', absOut], planRoot);
      assert.equal(escapeAbs.status, 1, 'an absolute --out exits 1');
      assert.match((escapeAbs.stdout ?? '') + (escapeAbs.stderr ?? ''), /must be a relative path that stays under \.nova\/heartbeat/, 'absolute --out is rejected with the sandbox message');
      assert.equal(await exists(absOut), false, 'absolute --out writes no file outside the sandbox');
      assert.doesNotMatch((escapeAbs.stdout ?? '') + (escapeAbs.stderr ?? ''), /[A-Za-z]:\\|\/(?:tmp|Users|home|var)\//, 'absolute --out error leaks no absolute path');

      const escapeDeep = runNova(['heartbeat', 'automation', 'export', '--target', 'cron', '--every', '15m', '--out', join('..', '..', 'nova-smoke-escape-deep.txt')], planRoot);
      assert.equal(escapeDeep.status, 1, 'a ../.. traversal --out exits 1');
      assert.match((escapeDeep.stdout ?? '') + (escapeDeep.stderr ?? ''), /must be a relative path that stays under \.nova\/heartbeat/, 'deep traversal --out is rejected with the sandbox message');
      assert.equal(await exists(resolve(planRoot, '..', '..', 'nova-smoke-escape-deep.txt')), false, 'deep traversal --out writes no file outside the sandbox');
    } finally {
      await rm(planRoot, { recursive: true, force: true });
    }

    // §4.1 automation cron — gate-valid cadences render identically representable cron specs.
    {
      const dailyCron = buildAutomationManifest({ target: 'cron', tickEveryMinutes: 1440, timezone: 'UTC' });
      assert.ok(dailyCron.body.includes('0 0 * * *'), 'cron 1440 renders daily 00:00');
      const twoHourCron = buildAutomationManifest({ target: 'cron', tickEveryMinutes: 120, timezone: 'UTC' });
      assert.ok(twoHourCron.body.includes('0 */2 * * *'), 'cron 120 renders every-2-hours');
      const hourlyCron = buildAutomationManifest({ target: 'cron', tickEveryMinutes: 60, timezone: 'UTC' });
      assert.ok(hourlyCron.body.includes('0 */1 * * *'), 'cron 60 renders the hourly whole-hour spec');
      assert.throws(() => buildAutomationManifest({ target: 'cron', tickEveryMinutes: 90, timezone: 'UTC' }), HeartbeatScheduleError, 'cron rejects the non-representable 90m cadence');
    }

    // §4.2 automation windows — the consistency gate accepts whole hours up to 1380 and rejects 1439/90 uniformly.
    {
      const dailyWin = buildAutomationManifest({ target: 'windows-task', tickEveryMinutes: 1440, timezone: 'UTC' });
      assert.ok(dailyWin.body.includes('/SC DAILY /ST 00:00'), 'windows 1440 renders the daily schedule');
      const maxHourWin = buildAutomationManifest({ target: 'windows-task', tickEveryMinutes: 1380, timezone: 'UTC' });
      assert.ok(maxHourWin.body.includes('/SC MINUTE /MO 1380'), 'windows 1380 (23h) renders a minute cadence');
      assert.throws(() => buildAutomationManifest({ target: 'windows-task', tickEveryMinutes: 1439, timezone: 'UTC' }), HeartbeatScheduleError, 'windows rejects 1439 (not a whole hour, not daily)');
      assert.throws(() => buildAutomationManifest({ target: 'windows-task', tickEveryMinutes: 90, timezone: 'UTC' }), HeartbeatScheduleError, 'windows rejects the non-representable 90m cadence');
    }

    // §4.3 parseDurationMinutes — non-integer numbers, malformed strings, and sub-minute inputs all throw; overflow clamps.
    {
      assert.throws(() => parseDurationMinutes(1.5), HeartbeatScheduleError, 'a non-integer number is rejected');
      assert.throws(() => parseDurationMinutes('1.5h'), HeartbeatScheduleError, 'a non-integer string is rejected');
      for (const sub of ['0', '00', 0]) {
        assert.throws(() => parseDurationMinutes(sub), HeartbeatScheduleError, `a sub-minute duration ${JSON.stringify(sub)} is rejected`);
      }
      assert.equal(parseDurationMinutes('120'), 120, 'a bare integer string parses to minutes');
      assert.equal(parseDurationMinutes(120), 120, 'a bare integer number parses to minutes');
    }

    // §4.4 parseClockHHMM — zero-padded 24-hour clocks parse; out-of-range and unpadded values throw.
    {
      assert.deepEqual(parseClockHHMM('00:00'), { h: 0, m: 0 }, 'midnight parses');
      assert.deepEqual(parseClockHHMM('23:59'), { h: 23, m: 59 }, 'last minute of the day parses');
      assert.deepEqual(parseClockHHMM('09:05'), { h: 9, m: 5 }, 'a zero-padded morning time parses');
      for (const bad of ['24:00', '7:60', '9:5', '12:60', '-1:00']) {
        assert.throws(() => parseClockHHMM(bad), /Invalid clock value/, `parseClockHHMM rejects ${JSON.stringify(bad)}`);
      }
    }

    // §4.5 projection cap — a huge horizon at a 1-minute cadence is capped at MAX_OCCURRENCES, never maxPerTask.
    {
      const capped = projectIntervalOccurrences({ nowMs: 0, horizonMin: MAX_HORIZON_MINUTES, everyMin: 1, maxPerTask: 999_999 });
      assert.equal(capped.length, MAX_OCCURRENCES, 'projection length is hard-capped at MAX_OCCURRENCES');
    }

    // §4.6 horizon clamp — both a giant string duration and a giant number clamp to MAX_HORIZON_MINUTES.
    {
      assert.equal(parseDurationMinutes('999999999d'), MAX_HORIZON_MINUTES, 'an enormous day-duration string clamps to the horizon');
      assert.equal(parseDurationMinutes(MAX_HORIZON_MINUTES + 10), MAX_HORIZON_MINUTES, 'an over-horizon number clamps to the horizon');
    }

    // §4.7 quiet-hours suppression — a wrap-past-midnight window suppresses only the covered occurrences.
    {
      const quietNow = Date.parse('2024-01-01T21:00:00.000Z');
      const quietTask: HeartbeatTaskConfig = { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 120, anchor: new Date(quietNow).toISOString() } };
      const wrapPlan = projectHeartbeatPlan({
        config: { enabled: true, timezone: 'UTC', quietHours: [{ start: '22:00', end: '06:00' }], tasks: [quietTask] },
        state: heartbeatState(),
        nowMs: quietNow,
        horizonMinutes: 600,
        maxPerTask: 10,
        heartbeatId: 'heartbeat_smoke',
      });
      const classes = wrapPlan.tasks[0]!.occurrences.map((occ) => `${occ.at}:${occ.classification}`);
      assert.deepEqual(
        classes,
        [
          '2024-01-01T21:00:00.000Z:would_run',
          '2024-01-01T23:00:00.000Z:quiet_hours',
          '2024-01-02T01:00:00.000Z:quiet_hours',
          '2024-01-02T03:00:00.000Z:quiet_hours',
          '2024-01-02T05:00:00.000Z:quiet_hours',
          '2024-01-02T07:00:00.000Z:would_run',
        ],
        'a wrapping quiet window suppresses only the covered occurrences (end is exclusive)',
      );
      assert.equal(wrapPlan.counts.quietHours, 4, 'plan counts exactly the four suppressed occurrences');
      assert.equal(wrapPlan.tasks[0]!.firstDueAt, '2024-01-01T21:00:00.000Z', 'firstDueAt is the first would_run before the quiet window');
    }

    // §4.8 inert quiet window — a start === end window is treated as no window (every occurrence would_run).
    {
      const inertTask: HeartbeatTaskConfig = { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60, anchor: now.toISOString() } };
      const inertPlan = projectHeartbeatPlan({
        config: { enabled: true, timezone: 'UTC', quietHours: [{ start: '03:00', end: '03:00' }], tasks: [inertTask] },
        state: heartbeatState(),
        nowMs: now.getTime(),
        horizonMinutes: 300,
        maxPerTask: 10,
        heartbeatId: 'heartbeat_smoke',
      });
      assert.ok(inertPlan.tasks[0]!.occurrences.every((occ) => occ.classification === 'would_run'), 'a zero-width quiet window suppresses nothing');
      assert.equal(inertPlan.counts.quietHours, 0, 'a zero-width quiet window counts no suppressions');
    }

    // §4.9 redaction depth — synthetic secrets and high-entropy blobs are scrubbed from plan and manifest projections.
    {
      const ENTROPY_BLOB = 'Zk9Q2mWf'.repeat(7);
      assert.equal(safeHeartbeatText(SYNTHETIC_SECRET), '<redacted>', 'a known secret pattern is redacted to the value sentinel');
      assert.equal(safeHeartbeatText(ENTROPY_BLOB), '[REDACTED:secret-like]', 'a high-entropy blob is caught by the secret-like sentinel');

      const planTaskUnsafe: HeartbeatTaskConfig = { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60, anchor: now.toISOString() } };
      const rawPlan = projectHeartbeatPlan({ config: { enabled: true, timezone: 'UTC', tasks: [planTaskUnsafe] }, state: heartbeatState(), nowMs: now.getTime(), horizonMinutes: 120, maxPerTask: 5, heartbeatId: 'heartbeat_smoke' });
      const poisonedPlan: HeartbeatPlanReport = {
        ...rawPlan,
        tasks: [{
          ...rawPlan.tasks[0]!,
          name: `name ${ENTROPY_BLOB}`,
          reason: `token=${SYNTHETIC_SECRET}`,
          occurrences: rawPlan.tasks[0]!.occurrences.map((occ, i) => (i === 0 ? { ...occ, note: `leak ${ENTROPY_BLOB} ${SYNTHETIC_SECRET}` } : occ)),
        }],
        safety: { ...rawPlan.safety, notes: [...rawPlan.safety.notes, `note ${SYNTHETIC_SECRET}`] },
      };
      const safePlan = safeHeartbeatPlanReport(poisonedPlan);
      const safePlanJson = JSON.stringify(safePlan);
      assert.doesNotMatch(safePlanJson, new RegExp(SYNTHETIC_SECRET, 'g'), 'safeHeartbeatPlanReport scrubs the synthetic secret');
      assert.doesNotMatch(safePlanJson, new RegExp(ENTROPY_BLOB, 'g'), 'safeHeartbeatPlanReport scrubs the high-entropy blob');
      assert.ok(safePlanJson.includes('[REDACTED:secret-like]'), 'safeHeartbeatPlanReport leaves the secret-like sentinel behind');
      assert.equal(safePlan.safety.secretsIncluded, false, 'safeHeartbeatPlanReport forces secretsIncluded false');
      assert.equal(safePlan.safety.schedulerInstalled, false, 'safeHeartbeatPlanReport forces schedulerInstalled false');

      const rawManifest = buildAutomationManifest({ target: 'cron', tickEveryMinutes: 15, timezone: 'UTC' });
      const poisonedManifest: HeartbeatAutomationManifest = {
        ...rawManifest,
        body: `${rawManifest.body}\n# leak ${ENTROPY_BLOB} token=${SYNTHETIC_SECRET}`,
        paths: { file: `automation/${ENTROPY_BLOB}.txt` },
      };
      const safeManifest = safeHeartbeatManifest(poisonedManifest);
      const safeManifestJson = JSON.stringify(safeManifest);
      assert.doesNotMatch(safeManifestJson, new RegExp(SYNTHETIC_SECRET, 'g'), 'safeHeartbeatManifest scrubs the synthetic secret');
      assert.doesNotMatch(safeManifestJson, new RegExp(ENTROPY_BLOB, 'g'), 'safeHeartbeatManifest scrubs the high-entropy blob');
      assert.equal(safeManifest.installed, false, 'safeHeartbeatManifest keeps installed false');
    }

    // §4.11 anchor precedence — explicit anchor beats stored lastRunAt beats nowMs, proven by three distinct first occurrences.
    {
      const everyMin = 30;
      const baseTask = (anchor?: string): HeartbeatTaskConfig => ({ id: 'anchor-task', kind: 'inspection', action: 'inspect', schedule: anchor ? { type: 'interval', everyMinutes: everyMin, anchor } : { type: 'interval', everyMinutes: everyMin } });
      const anchorNow = Date.parse('2026-01-02T00:05:00.000Z');
      const stateWith = (lastRunAt?: string): HeartbeatState => ({ schemaVersion: HEARTBEAT_SCHEMA_VERSION, heartbeatId: 'heartbeat_smoke', enabled: true, updatedAt: new Date(anchorNow).toISOString(), tasks: lastRunAt ? { 'anchor-task': { lastRunAt } } : {} });
      const firstOf = (task: HeartbeatTaskConfig, state: HeartbeatState): string | undefined =>
        projectHeartbeatPlan({ config: { enabled: true, timezone: 'UTC', tasks: [task] }, state, nowMs: anchorNow, horizonMinutes: 180, maxPerTask: 5, heartbeatId: 'heartbeat_smoke' }).tasks[0]!.occurrences[0]?.at;
      // A — explicit anchor 00:10 wins even with a conflicting stored lastRunAt 00:00.
      assert.equal(firstOf(baseTask('2026-01-02T00:10:00.000Z'), stateWith('2026-01-02T00:00:00.000Z')), '2026-01-02T00:10:00.000Z', 'explicit anchor takes precedence over lastRunAt');
      // B — no anchor: stored lastRunAt 00:00 sets the phase, first occurrence is 00:30.
      assert.equal(firstOf(baseTask(), stateWith('2026-01-02T00:00:00.000Z')), '2026-01-02T00:30:00.000Z', 'stored lastRunAt sets the phase when no anchor is given');
      // C — neither anchor nor lastRunAt: phase falls back to nowMs, first occurrence is nowMs itself.
      assert.equal(firstOf(baseTask(), stateWith()), '2026-01-02T00:05:00.000Z', 'nowMs is the fallback anchor (inclusive first occurrence)');
    }

    // §4.12 planId stability — the id excludes heartbeatId, so two instances with the same inputs share a planId.
    {
      const idTask: HeartbeatTaskConfig = { id: 'inspect-langs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60, anchor: now.toISOString() } };
      const common = { config: { enabled: true, timezone: 'UTC', tasks: [idTask] }, state: heartbeatState(), nowMs: now.getTime(), horizonMinutes: 180, maxPerTask: 5 };
      const planA = projectHeartbeatPlan({ ...common, heartbeatId: 'heartbeat_alpha' });
      const planB = projectHeartbeatPlan({ ...common, heartbeatId: 'heartbeat_beta' });
      assert.equal(planA.planId, planB.planId, 'planId is identical across heartbeat instances with the same inputs');
      assert.notEqual(planA.heartbeatId, planB.heartbeatId, 'the two plans still carry distinct heartbeat ids');
      const idInputs: PlanIdInputs = { generatedForNow: now.toISOString(), horizonMinutes: 180, maxPerTask: 5, timezone: 'UTC', configDigest: configDigest(common.config) };
      assert.equal(computePlanId(idInputs), computePlanId({ ...idInputs }), 'computePlanId is a pure function of its inputs');
    }

    // §4.13 stableStringify — object key order is normalized while array order is preserved.
    {
      assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}', 'object keys are sorted deeply');
      assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }), 'key order does not affect the digest input');
      assert.equal(stableStringify({ x: [3, 1, 2] }), '{"x":[3,1,2]}', 'array order is preserved');
    }

    // ===== ADR-002 Heartbeat V3 Slice 1 — fail-closed triple-gate scaffolding =====

    // ADR-002 §D2 — the pure triple-gate decision table. With safety 'ok',
    // precedence A → C → B yields four reachable modes; the eight
    // (gateA, gateC, gateB) combinations cover the published truth table.
    {
      const gateCase = (a: boolean, c: boolean, b: boolean) =>
        decideHeartbeatExecution({
          flags: { heartbeatExec: a, liveLlm: true, writeTools: true },
          taskNeeds: { llm: false, write: false },
          approval: { status: b ? 'approved' : 'none' },
          sandbox: { available: c },
          safety: { status: 'ok' },
        });
      const truthTable: Array<{ a: boolean; c: boolean; b: boolean; mode: HeartbeatExecutionMode; decidedBy: HeartbeatExecutionDecidedBy }> = [
        { a: false, c: false, b: false, mode: 'dry_run', decidedBy: 'gate-a-flags' },
        { a: false, c: false, b: true, mode: 'dry_run', decidedBy: 'gate-a-flags' },
        { a: false, c: true, b: false, mode: 'dry_run', decidedBy: 'gate-a-flags' },
        { a: false, c: true, b: true, mode: 'dry_run', decidedBy: 'gate-a-flags' },
        { a: true, c: false, b: false, mode: 'refused', decidedBy: 'gate-c-sandbox' },
        { a: true, c: true, b: false, mode: 'needs_user_action', decidedBy: 'gate-b-approval' },
        { a: true, c: false, b: true, mode: 'refused', decidedBy: 'gate-c-sandbox' },
        { a: true, c: true, b: true, mode: 'execute', decidedBy: 'all-gates' },
      ];
      for (const row of truthTable) {
        const decision = gateCase(row.a, row.c, row.b);
        assert.equal(decision.mode, row.mode, `gate(a=${row.a},c=${row.c},b=${row.b}) mode is ${row.mode}`);
        assert.equal(decision.decidedBy, row.decidedBy, `gate(a=${row.a},c=${row.c},b=${row.b}) decidedBy is ${row.decidedBy}`);
        assert.deepEqual(decision.gate, { a: row.a, b: row.b, c: row.c }, `gate(a=${row.a},c=${row.c},b=${row.b}) echoes its booleans`);
      }
    }

    // ADR-002 §D2 Gate A — capability composition. eval needs the LLM,
    // maintenance needs write tools, inspection/batch-dry-run need neither; the
    // master switch gates everything and each capability flag gates its own kind.
    {
      assert.deepEqual(heartbeatTaskNeeds('eval'), { llm: true, write: false }, 'eval consumes the LLM only');
      assert.deepEqual(heartbeatTaskNeeds('maintenance'), { llm: false, write: true }, 'maintenance consumes write tools only');
      assert.deepEqual(heartbeatTaskNeeds('inspection'), { llm: false, write: false }, 'inspection consumes neither capability');
      assert.deepEqual(heartbeatTaskNeeds('batch-dry-run'), { llm: false, write: false }, 'batch-dry-run consumes neither capability');
      const allOn = { heartbeatExec: true, liveLlm: true, writeTools: true };
      assert.equal(heartbeatGateA(allOn, heartbeatTaskNeeds('eval')), true, 'eval opens Gate A when every flag is on');
      assert.equal(heartbeatGateA({ ...allOn, liveLlm: false }, heartbeatTaskNeeds('eval')), false, 'eval closes Gate A without live LLM');
      assert.equal(heartbeatGateA({ ...allOn, writeTools: false }, heartbeatTaskNeeds('maintenance')), false, 'maintenance closes Gate A without write tools');
      assert.equal(heartbeatGateA({ ...allOn, writeTools: false }, heartbeatTaskNeeds('inspection')), true, 'inspection still opens Gate A without write tools');
      assert.equal(heartbeatGateA({ heartbeatExec: false, liveLlm: true, writeTools: true }, heartbeatTaskNeeds('inspection')), false, 'the master switch closes Gate A for every kind');
    }

    // ADR-002 SI-5 — dangerous kinds can never reach 'execute'. They are
    // non-'ok' at classification, and even if every gate is forced open the
    // safety pre-empt pins the decision to dry_run (decidedBy 'task-safety').
    {
      for (const kind of ['shell', 'write', 'git', 'network', 'memory-write', 'auto-resume']) {
        const safety = classifyHeartbeatTaskSafety({ id: `danger-${kind}`, kind, schedule: { type: 'interval', everyMinutes: 5 } });
        assert.notEqual(safety.status, 'ok', `dangerous kind "${kind}" is never classified ok`);
        const decision = decideHeartbeatExecution({
          flags: { heartbeatExec: true, liveLlm: true, writeTools: true },
          taskNeeds: heartbeatTaskNeeds(kind),
          approval: { status: 'approved' },
          sandbox: { available: true },
          safety: { status: safety.status },
        });
        assert.equal(decision.decidedBy, 'task-safety', `dangerous kind "${kind}" is pre-empted by safety`);
        assert.equal(decision.mode, 'dry_run', `dangerous kind "${kind}" stays dry_run`);
        assert.notEqual(decision.mode, 'execute', `dangerous kind "${kind}" never executes`);
      }
    }

    // ADR-002 SI-1 / SI-2 — default-off parity then fail-closed refusal, proven
    // in-process on one temp project so the master flag is the only variable.
    {
      const gateRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-gate-'));
      const gateConfig: HeartbeatConfig = { enabled: true, tasks: [{ id: 'inspect-docs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } }] };
      const priorExec = process.env.NOVA_ENABLE_HEARTBEAT_EXEC;
      try {
        // SI-1 — flag OFF: byte-for-byte the V2 dry-run; the task stays 'due'.
        delete process.env.NOVA_ENABLE_HEARTBEAT_EXEC;
        const offTick = await runHeartbeatDryRunTick({ projectRoot: gateRoot, config: gateConfig });
        assert.equal(offTick.schemaVersion, HEARTBEAT_SCHEMA_VERSION, 'a tick stamps the v2 schema version');
        assert.equal(offTick.status, 'dry_run_completed', 'flag off completes a dry run');
        assert.equal(offTick.dryRun, true, 'flag off is a dry run');
        assert.equal(offTick.safety.autonomousActionsExecuted, false, 'flag off executes nothing');
        assert.equal(offTick.safety.llmInvoked, false, 'flag off invokes no LLM');
        assert.equal(offTick.safety.toolsInvoked, false, 'flag off invokes no tools');
        assert.equal(offTick.counts.due, 1, 'the inspection task is due under default-off');
        assert.equal(offTick.tasks[0]!.status, 'due', 'flag off leaves the task due (V2 parity)');
        // SI-2 — flag ON, no sandbox: fail-closed refusal, still no execution.
        process.env.NOVA_ENABLE_HEARTBEAT_EXEC = '1';
        const onTick = await runHeartbeatDryRunTick({ projectRoot: gateRoot, config: gateConfig });
        assert.equal(onTick.status, 'refused', 'flag on with no sandbox refuses');
        assert.equal(onTick.dryRun, true, 'a refusal is still a dry run (nothing ran)');
        assert.equal(onTick.safety.autonomousActionsExecuted, false, 'a refusal executes nothing');
        assert.equal(onTick.tasks[0]!.status, 'refused', 'the due task is refused fail-closed');
        assert.equal(onTick.counts.due, 0, 'a refused task is no longer counted due');
      } finally {
        restoreEnv('NOVA_ENABLE_HEARTBEAT_EXEC', priorExec);
        await rm(gateRoot, { recursive: true, force: true });
      }
    }

    // ADR-002 §D5 — a V1 state file (schemaVersion 1, no execution fields) is
    // read forward: the store re-stamps schemaVersion 2, preserves lastRunAt and
    // task history, and leaves the new execution fields undefined.
    {
      const migrateRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-migrate-'));
      try {
        const store = new HeartbeatStore(migrateRoot);
        await store.ensure();
        const v1State = {
          schemaVersion: 1,
          heartbeatId: 'heartbeat_legacy',
          enabled: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
          tasks: { 'inspect-docs': { lastRunAt: '2026-01-01T00:00:00.000Z', lastDryRunAt: '2026-01-01T00:00:00.000Z', lastStatus: 'due' } },
        };
        await writeFile(store.paths.state, `${JSON.stringify(v1State, null, 2)}\n`, 'utf-8');
        const migrated = await store.readState(true);
        assert.equal(migrated.schemaVersion, HEARTBEAT_SCHEMA_VERSION, 'readState re-stamps the schema version');
        assert.equal(migrated.schemaVersion, 2, 'the re-stamped schema version is 2');
        assert.equal(migrated.heartbeatId, 'heartbeat_legacy', 'the legacy heartbeat id is preserved');
        assert.equal(migrated.tasks['inspect-docs']!.lastStatus, 'due', 'task history is preserved across migration');
        assert.equal(migrated.tasks['inspect-docs']!.lastRunAt, '2026-01-01T00:00:00.000Z', 'lastRunAt is preserved across migration');
        assert.equal(migrated.tasks['inspect-docs']!.lastExecAt, undefined, 'the new lastExecAt field defaults to undefined');
        assert.equal(migrated.tasks['inspect-docs']!.pendingApprovalId, undefined, 'the new approval field defaults to undefined');
      } finally {
        await rm(migrateRoot, { recursive: true, force: true });
      }
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
