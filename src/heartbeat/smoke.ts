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
import { z } from 'zod';
import { ToolRegistry } from '../tools/registry.js';
import type { NovaTool } from '../types.js';
import type {
  HeartbeatApprovalGateway,
  HeartbeatApprovalRequest,
  HeartbeatApprovalRequester,
  HeartbeatApprovalResolution,
  HeartbeatAutomationManifest,
  HeartbeatConfig,
  HeartbeatExecutionCapability,
  HeartbeatExecutionDecidedBy,
  HeartbeatExecutionFlags,
  HeartbeatExecutionMode,
  HeartbeatPlanReport,
  HeartbeatQuietWindow,
  HeartbeatSessionApprovalLink,
  HeartbeatState,
  HeartbeatTaskConfig,
  HeartbeatTaskState,
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
    assert.match(help.stdout ?? '', /nova heartbeat approvals/, 'help documents the read-only approvals ledger');

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
    assert.ok(guardedModules.length >= 13, `static guard sweeps the heartbeat module set (found ${guardedModules.length})`);
    assert.ok(guardedModules.includes('execution_gate.ts'), 'static guard includes the new execution_gate module');
    assert.ok(guardedModules.includes('executor.ts'), 'static guard includes the new executor module');
    for (const name of guardedModules) {
      const source = await readFile(join(heartbeatDir, name), 'utf-8');
      assert.doesNotMatch(source, forbiddenExecution, `src/heartbeat/${name} carries no spawn/timer/execute primitive`);
      // ADR-002 §D6 / CAVEAT-1 import-denylist — a heartbeat module may not import
      // the tool runtime or session loop, and may reach the sandbox ONLY through
      // the read-only probe seam (probe.js), never a runtime sandbox factory.
      assert.doesNotMatch(source, /from\s+['"][^'"]*\/(?:tools|session)\//, `src/heartbeat/${name} does not import the tool/session runtime`);
      assert.doesNotMatch(source, /from\s+['"][^'"]*\/sandbox\/(?!probe\.js)/, `src/heartbeat/${name} reaches the sandbox only via the read-only probe`);
    }
    // ADR-002 §D6 / CAVEAT-1 — the heartbeat directory is flat: no subdirectory
    // can smuggle an execution primitive past the per-file sweep above.
    const heartbeatSubdirs = (await readdir(heartbeatDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(heartbeatSubdirs, [], `the heartbeat directory stays flat (found ${heartbeatSubdirs.join(', ') || 'none'})`);
    // ADR-002 §D6 / SI-3 — the executor lists and reads approvals but never
    // decides one: the gate's `.decide(` write primitive is structurally absent.
    const executorSource = await readFile(join(heartbeatDir, 'executor.ts'), 'utf-8');
    assert.doesNotMatch(executorSource, /\.decide\(/, 'SI-3: the heartbeat executor never decides an approval');

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

    // ADR-002 §D7 — Slice 2 cross-tick approval lifecycle, proven OFFLINE with a
    // fixed `now` clock and a stubbed approval verdict. Inspection needs neither
    // LLM nor write, so it is the one kind that reaches Gate B and drives the
    // mint → resolve → execute / block / expire cycle deterministically.
    {
      const onFlags: HeartbeatExecutionFlags = { heartbeatExec: true, liveLlm: true, writeTools: true };
      const execConfig: HeartbeatConfig = { enabled: true, tasks: [{ id: 'inspect-docs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } }] };
      const taskStateOf = async (projectRoot: string): Promise<HeartbeatTaskState | undefined> => {
        const persisted = JSON.parse(await readFile(new HeartbeatStore(projectRoot).paths.state, 'utf-8')) as HeartbeatState;
        return persisted.tasks['inspect-docs'];
      };
      // A gateway that records every id it is asked to resolve and answers with a
      // fixed verdict, so a test can assert BOTH the verdict's effect and whether
      // the gateway was consulted at all (expiry/mint must short-circuit it).
      const trackingGateway = (verdict: HeartbeatApprovalResolution): { gateway: HeartbeatApprovalGateway; calls: string[] } => {
        const calls: string[] = [];
        return { calls, gateway: { async resolve(approvalId: string): Promise<HeartbeatApprovalResolution> { calls.push(approvalId); return verdict; } } };
      };

      // ADR-002 §S4 — delegated execution capabilities. Each is a pure stub that
      // records the kind it was asked to run and returns a fixed outcome, so a test
      // can drive every refused/executed branch of resolveDelegatedExecution without
      // a real sandbox. The summary carries a synthetic secret where a leak is being
      // probed (D4.5 / R3), proving redaction holds at the trust boundary.
      const okCapability: HeartbeatExecutionCapability = {
        async run({ kind }) { return { ok: true, summary: `task=${kind} exit=0 dur=4ms`, exitCode: 0, durationMs: 4 }; },
      };
      const throwingCapability: HeartbeatExecutionCapability = {
        async run() { throw new Error(`delegated boom ${SYNTHETIC_SECRET}`); },
      };
      const failingCapability: HeartbeatExecutionCapability = {
        async run({ kind }) { return { ok: false, summary: `task=${kind} exit=1 dur=2ms`, exitCode: 1, durationMs: 2 }; },
      };
      const leakyCapability: HeartbeatExecutionCapability = {
        async run({ kind }) { return { ok: true, summary: `task=${kind} exit=0 token=${SYNTHETIC_SECRET}`, exitCode: 0, durationMs: 1 }; },
      };

      // Mint a fresh approval (T0, no capability) then resolve it one minute later
      // (T1) WITH the supplied capability, returning the grant tick, the persisted
      // task state after it, the minted id, and the ids the gateway was asked to
      // resolve — so each delegated-execution test asserts status, bookkeeping, and
      // single-shot consumption from one shared, temp-root-scoped lifecycle.
      const runGrantedTick = async (capability: HeartbeatExecutionCapability | undefined) => {
        const grantRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-grant-'));
        const { gateway, calls } = trackingGateway('approved');
        try {
          await runHeartbeatDryRunTick({ projectRoot: grantRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
          const mintedId = (await taskStateOf(grantRoot))!.pendingApprovalId!;
          const tick = await runHeartbeatDryRunTick({ projectRoot: grantRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, capability, now: new Date('2026-03-01T00:01:00.000Z') });
          const state = await taskStateOf(grantRoot);
          return { tick, state, mintedId, calls };
        } finally {
          await rm(grantRoot, { recursive: true, force: true });
        }
      };

      // SI-10 + SI-9 — a granted approval executes one tick later, then the next
      // due tick must mint a FRESH approval (the grant is single-shot).
      {
        const approveRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-approve-'));
        const { gateway, calls } = trackingGateway('approved');
        try {
          // T0 — first sight of a due task: no approval exists yet, so one is minted
          // and the tick halts at needs_user_action WITHOUT consulting the gateway.
          const t0 = await runHeartbeatDryRunTick({ projectRoot: approveRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
          assert.equal(t0.tasks[0]!.status, 'needs_user_action', 'T0 mints an approval and awaits the user');
          assert.equal(t0.status, 'dry_run_completed', 'T0 is a dry run: a mint executes nothing');
          assert.equal(t0.safety.autonomousActionsExecuted, false, 'T0 executes nothing');
          assert.equal(calls.length, 0, 'minting a fresh approval never consults the gateway');
          const s0 = await taskStateOf(approveRoot);
          const firstId = s0!.pendingApprovalId;
          assert.ok(firstId !== undefined && firstId.startsWith('hb-appr-'), 'T0 persists a synthetic hb-appr- approval id');
          assert.equal(s0!.pendingApprovalAt, '2026-03-01T00:00:00.000Z', 'the pending approval is stamped with the injected clock');
          assert.equal(s0!.lastExecStatus, 'needs_user_action', 'T0 records the awaiting-user execution status');
          assert.equal(s0!.lastRunAt, undefined, 'T0 never marks a run');

          // T1 — the gateway now grants the pending id: all gates open, the task
          // executes, and the pending request is cleared.
          const t1 = await runHeartbeatDryRunTick({ projectRoot: approveRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, capability: okCapability, now: new Date('2026-03-01T00:01:00.000Z') });
          assert.equal(t1.tasks[0]!.status, 'executed', 'T1 executes once the approval is granted');
          assert.equal(t1.status, 'executed', 'T1 tick status is executed');
          assert.equal(t1.dryRun, false, 'an executed tick is not a dry run');
          assert.equal(t1.safety.autonomousActionsExecuted, true, 'T1 records an autonomous action');
          assert.deepEqual(calls, [firstId], 'T1 resolves exactly the pending approval id, once');
          const s1 = await taskStateOf(approveRoot);
          assert.equal(s1!.pendingApprovalId, undefined, 'T1 clears the pending approval after granting');
          assert.equal(s1!.lastExecStatus, 'executed', 'T1 records an executed status');
          assert.equal(s1!.lastExecAt, '2026-03-01T00:01:00.000Z', 'lastExecAt uses the injected clock');
          assert.equal(s1!.lastRunAt, '2026-03-01T00:01:00.000Z', 'lastRunAt uses the injected clock');
          assert.equal(s1!.lastApprovalId, firstId, 'the granted approval id is kept for the audit trail');

          // T2 — one interval later the task is due again; the prior grant is spent,
          // so a NEW approval is minted (SI-9) without re-consulting the gateway.
          const t2 = await runHeartbeatDryRunTick({ projectRoot: approveRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T01:02:00.000Z') });
          assert.equal(t2.tasks[0]!.status, 'needs_user_action', 'T2 re-requests approval for the next run');
          assert.equal(t2.safety.autonomousActionsExecuted, false, 'T2 executes nothing: the grant was single-shot');
          assert.equal(calls.length, 1, 'a re-request mints anew and never reuses the spent grant');
          const s2 = await taskStateOf(approveRoot);
          assert.ok(s2!.pendingApprovalId !== undefined && s2!.pendingApprovalId !== firstId, 'T2 mints a fresh approval id, distinct from the spent one');
          assert.equal(s2!.lastExecAt, '2026-03-01T00:01:00.000Z', 'the prior execution timestamp is preserved across the re-request');
          assert.equal(s2!.lastRunAt, '2026-03-01T00:01:00.000Z', 'the prior run timestamp is preserved');
          assert.equal(s2!.lastApprovalId, firstId, 'the prior granted approval id remains in the audit trail');
          assert.equal(s2!.lastExecStatus, 'needs_user_action', 'T2 returns to awaiting-user status');
        } finally {
          await rm(approveRoot, { recursive: true, force: true });
        }
      }

      // A denied approval blocks the task and discards the request (no execution).
      {
        const denyRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-deny-'));
        const { gateway, calls } = trackingGateway('denied');
        try {
          await runHeartbeatDryRunTick({ projectRoot: denyRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
          const deniedId = (await taskStateOf(denyRoot))!.pendingApprovalId;
          const blockedTick = await runHeartbeatDryRunTick({ projectRoot: denyRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:05:00.000Z') });
          assert.equal(blockedTick.tasks[0]!.status, 'blocked', 'a denied approval blocks the task');
          assert.equal(blockedTick.status, 'blocked', 'the tick status reflects the block');
          assert.equal(blockedTick.safety.autonomousActionsExecuted, false, 'a denied task executes nothing');
          assert.equal(blockedTick.counts.blocked, 1, 'the denied task is counted blocked');
          assert.deepEqual(calls, [deniedId], 'the denial resolves exactly the pending id, once');
          const denyState = await taskStateOf(denyRoot);
          assert.equal(denyState!.pendingApprovalId, undefined, 'a denial discards the pending request');
          assert.equal(denyState!.lastExecStatus, 'refused', 'a denial is recorded as a refused execution');
          assert.equal(denyState!.lastApprovalId, deniedId, 'the denied id is retained for the audit trail');
          assert.equal(denyState!.lastExecAt, undefined, 'a denied task never stamps an execution time');
        } finally {
          await rm(denyRoot, { recursive: true, force: true });
        }
      }

      // A pending approval older than the 24h TTL expires — even when the gateway
      // WOULD grant it. Expiry is decided before the gateway, which is bypassed.
      {
        const expireRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-expire-'));
        const { gateway, calls } = trackingGateway('approved');
        try {
          await runHeartbeatDryRunTick({ projectRoot: expireRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
          const expiredTick = await runHeartbeatDryRunTick({ projectRoot: expireRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-02T01:00:00.000Z') });
          assert.equal(expiredTick.tasks[0]!.status, 'needs_user_action', 'an expired approval returns to awaiting-user');
          assert.equal(expiredTick.status, 'dry_run_completed', 'an expiry executes nothing');
          assert.equal(calls.length, 0, 'expiry short-circuits BEFORE the gateway, which is never consulted');
          const expireState = await taskStateOf(expireRoot);
          assert.equal(expireState!.pendingApprovalId, undefined, 'an expired approval is reset');
          assert.equal(expireState!.lastExecStatus, 'needs_user_action', 'an expiry records awaiting-user, not executed');
          assert.equal(expireState!.lastExecAt, undefined, 'an expired task never executes');
        } finally {
          await rm(expireRoot, { recursive: true, force: true });
        }
      }

      // SI-1 — with the master flag OFF the approval gateway is never consulted and
      // the task stays 'due': byte-identical to V2 even with a gateway injected.
      {
        const offRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-flags-off-'));
        const offFlags: HeartbeatExecutionFlags = { heartbeatExec: false, liveLlm: true, writeTools: true };
        const { gateway, calls } = trackingGateway('approved');
        try {
          const parityTick = await runHeartbeatDryRunTick({ projectRoot: offRoot, config: execConfig, flags: offFlags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
          assert.equal(parityTick.tasks[0]!.status, 'due', 'flags off leaves the task due (V2 parity)');
          assert.equal(parityTick.status, 'dry_run_completed', 'flags off completes a dry run');
          assert.equal(parityTick.dryRun, true, 'flags off is a dry run');
          assert.equal(parityTick.counts.due, 1, 'the inspection task is counted due');
          assert.equal(parityTick.safety.autonomousActionsExecuted, false, 'flags off executes nothing');
          assert.equal(calls.length, 0, 'flags off never consults the approval gateway');
          const offState = await taskStateOf(offRoot);
          assert.equal(offState!.pendingApprovalId, undefined, 'flags off mints no approval');
          assert.equal(offState!.lastExecStatus, undefined, 'flags off writes no execution bookkeeping (SI-1)');
          assert.equal(offState!.lastExecAt, undefined, 'flags off stamps no execution time');
        } finally {
          await rm(offRoot, { recursive: true, force: true });
        }
      }

      // ADR-002 §SEC Slice 4b — the session-namespace approval bridge. At mint
      // time a wired requester creates a real session approval and hands back a
      // (approvalId, runId, sessionId) locator; a later tick passes that locator
      // to the gateway so an operator's verdict can drive Gate B. These tests
      // prove OFFLINE that the locator is captured and persisted (OQ2), that the
      // bridge fails closed when either port throws (§SEC-B1), and that the
      // session linkage NEVER leaks into the redacted tick report (§SEC-C5).
      {
        // Records the exact request it is handed and returns a fixed link, so a
        // test can assert BOTH the secret-free request shape and the persisted
        // locator from a single mint.
        const capturingRequester = (link: HeartbeatSessionApprovalLink): { requester: HeartbeatApprovalRequester; requests: HeartbeatApprovalRequest[] } => {
          const requests: HeartbeatApprovalRequest[] = [];
          return { requests, requester: { async request(req: HeartbeatApprovalRequest): Promise<HeartbeatSessionApprovalLink> { requests.push(req); return link; } } };
        };
        // Returns a fixed link without recording — for the leak and throw probes.
        const linkOf = (link: HeartbeatSessionApprovalLink): HeartbeatApprovalRequester => ({ async request(): Promise<HeartbeatSessionApprovalLink> { return link; } });
        // A benign always-'pending' gateway, so a mint can be staged without granting.
        const pendingGateway: HeartbeatApprovalGateway = { async resolve(): Promise<HeartbeatApprovalResolution> { return 'pending'; } };

        // OQ2 — a wired requester's locator is captured and persisted beside the
        // synthetic id, and the request carries only identity, kind, and 'shell'.
        {
          const linkRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-link-'));
          const { requester, requests } = capturingRequester({ sessionApprovalId: 'approval_1', sessionRunId: 'run_link', sessionId: 'ses_link' });
          try {
            await runHeartbeatDryRunTick({ projectRoot: linkRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: pendingGateway, approvalRequester: requester, now: new Date('2026-03-01T00:00:00.000Z') });
            assert.equal(requests.length, 1, 'a mint with a wired requester asks it exactly once');
            assert.deepEqual(requests[0], { taskId: 'inspect-docs', kind: 'inspection', capability: 'shell' }, 'the request carries only task identity, kind, and the fixed shell capability');
            const linked = await taskStateOf(linkRoot);
            assert.equal(linked!.pendingSessionApprovalId, 'approval_1', 'the session approval id is persisted as the locator');
            assert.equal(linked!.pendingSessionRunId, 'run_link', 'the session run id is persisted as the locator');
            assert.equal(linked!.pendingSessionId, 'ses_link', 'the session id is persisted as the locator');
            assert.ok(linked!.pendingApprovalId !== undefined && linked!.pendingApprovalId.startsWith('hb-appr-'), 'the synthetic hb-appr- id is persisted alongside the session locator');
          } finally {
            await rm(linkRoot, { recursive: true, force: true });
          }
        }

        // OQ2 / SI-1 — with NO requester the mint is synthetic-only: the hb-appr-
        // id persists but no session locator is written (Slice-2 parity).
        {
          const soloRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-solo-'));
          try {
            await runHeartbeatDryRunTick({ projectRoot: soloRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: pendingGateway, now: new Date('2026-03-01T00:00:00.000Z') });
            const solo = await taskStateOf(soloRoot);
            assert.ok(solo!.pendingApprovalId !== undefined && solo!.pendingApprovalId.startsWith('hb-appr-'), 'a requester-less mint still persists a synthetic hb-appr- id');
            assert.equal(solo!.pendingSessionApprovalId, undefined, 'no requester means no persisted session approval id');
            assert.equal(solo!.pendingSessionRunId, undefined, 'no requester means no persisted session run id');
            assert.equal(solo!.pendingSessionId, undefined, 'no requester means no persisted session id');
          } finally {
            await rm(soloRoot, { recursive: true, force: true });
          }
        }

        // §SEC-B1 — a requester that THROWS at mint fails closed: the mint falls
        // back to synthetic-only (no locator) and the thrown secret never persists.
        {
          const reqThrowRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-req-throw-'));
          const throwingRequester: HeartbeatApprovalRequester = { async request(): Promise<HeartbeatSessionApprovalLink> { throw new Error(`requester boom ${SYNTHETIC_SECRET}`); } };
          try {
            const tick = await runHeartbeatDryRunTick({ projectRoot: reqThrowRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: pendingGateway, approvalRequester: throwingRequester, now: new Date('2026-03-01T00:00:00.000Z') });
            assert.equal(tick.tasks[0]!.status, 'needs_user_action', 'B1: a throwing requester still mints and awaits the user');
            assert.equal(tick.safety.autonomousActionsExecuted, false, 'B1: a throwing requester executes nothing');
            const thrown = await taskStateOf(reqThrowRoot);
            assert.ok(thrown!.pendingApprovalId !== undefined && thrown!.pendingApprovalId.startsWith('hb-appr-'), 'B1: a throwing requester falls back to a synthetic-only mint');
            assert.equal(thrown!.pendingSessionApprovalId, undefined, 'B1: a throwing requester writes no session locator');
            const rawReqThrow = await readFile(new HeartbeatStore(reqThrowRoot).paths.state, 'utf-8');
            assert.ok(!rawReqThrow.includes(SYNTHETIC_SECRET), 'B1: a requester error never leaks its message into state');
          } finally {
            await rm(reqThrowRoot, { recursive: true, force: true });
          }
        }

        // §SEC-B1 — a gateway that THROWS while resolving a LINKED approval fails
        // closed to 'pending': the task keeps awaiting, executes nothing even with
        // a capability available, and RETAINS both the pending id and its locator.
        {
          const gwThrowRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-gw-throw-'));
          const benignLink: HeartbeatSessionApprovalLink = { sessionApprovalId: 'approval_1', sessionRunId: 'run_gw', sessionId: 'ses_gw' };
          const throwingGateway: HeartbeatApprovalGateway = { async resolve(): Promise<HeartbeatApprovalResolution> { throw new Error('gateway boom'); } };
          try {
            await runHeartbeatDryRunTick({ projectRoot: gwThrowRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: pendingGateway, approvalRequester: linkOf(benignLink), now: new Date('2026-03-01T00:00:00.000Z') });
            const minted = await taskStateOf(gwThrowRoot);
            assert.equal(minted!.pendingSessionApprovalId, 'approval_1', 'T0 persists the session locator to resolve later');
            const tick = await runHeartbeatDryRunTick({ projectRoot: gwThrowRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: throwingGateway, capability: okCapability, now: new Date('2026-03-01T00:01:00.000Z') });
            assert.equal(tick.tasks[0]!.status, 'needs_user_action', 'B1: a throwing gateway keeps the task awaiting the user');
            assert.equal(tick.status, 'dry_run_completed', 'B1: a throwing gateway executes nothing');
            assert.equal(tick.safety.autonomousActionsExecuted, false, 'B1: a throwing gateway never auto-grants, even with a capability present');
            const held = await taskStateOf(gwThrowRoot);
            assert.equal(held!.pendingApprovalId, minted!.pendingApprovalId, 'B1: the pending approval id is retained across a gateway error');
            assert.equal(held!.pendingSessionApprovalId, 'approval_1', 'B1: the session approval locator is retained for a later resolve');
            assert.equal(held!.pendingSessionRunId, 'run_gw', 'B1: the run locator is retained');
            assert.equal(held!.pendingSessionId, 'ses_gw', 'B1: the session id locator is retained');
            assert.equal(held!.lastExecStatus, 'needs_user_action', 'B1: the await status is recorded');
            assert.equal(held!.lastExecAt, undefined, 'B1: a fail-closed tick never stamps an execution time');
          } finally {
            await rm(gwThrowRoot, { recursive: true, force: true });
          }
        }

        // §SEC-C5 — the locator is bridge-only state: even sentinel-loud session
        // ids land in state.json yet NEVER appear in the redacted tick report.
        {
          const leakRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-link-leak-'));
          const sentinels: HeartbeatSessionApprovalLink = { sessionApprovalId: 'approval_LEAK5b', sessionRunId: 'run_LEAK5b', sessionId: 'ses_LEAK5b' };
          try {
            const tick = await runHeartbeatDryRunTick({ projectRoot: leakRoot, config: execConfig, flags: onFlags, sandboxAvailable: true, approvalGateway: pendingGateway, approvalRequester: linkOf(sentinels), now: new Date('2026-03-01T00:00:00.000Z') });
            const reportText = JSON.stringify(tick);
            assert.ok(!reportText.includes('approval_LEAK5b'), 'C5: the session approval id never reaches the tick report');
            assert.ok(!reportText.includes('run_LEAK5b'), 'C5: the session run id never reaches the tick report');
            assert.ok(!reportText.includes('ses_LEAK5b'), 'C5: the session id never reaches the tick report');
            const rawLeak = await readFile(new HeartbeatStore(leakRoot).paths.state, 'utf-8');
            assert.ok(rawLeak.includes('approval_LEAK5b') && rawLeak.includes('run_LEAK5b') && rawLeak.includes('ses_LEAK5b'), 'C5: the locator IS persisted to state.json, proving the report omission is real redaction');
          } finally {
            await rm(leakRoot, { recursive: true, force: true });
          }
        }
      }

      // The read-only `nova heartbeat approvals` CLI surfaces the persisted ledger
      // and NEVER writes state (byte-identical before/after) nor decides anything.
      {
        const cliRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-cli-'));
        try {
          await mkdir(join(cliRoot, '.nova'), { recursive: true });
          await writeFile(projectConfigPath(cliRoot), JSON.stringify({
            schemaVersion: 1,
            heartbeat: { enabled: true, tasks: [{ id: 'inspect-docs', name: 'Inspect docs', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } }] },
          }, null, 2), 'utf-8');
          const cliStore = new HeartbeatStore(cliRoot);
          await cliStore.ensure();
          const seededId = 'hb-appr-12345678-1234-4123-8123-1234567890ab';
          const seededState: HeartbeatState = {
            schemaVersion: HEARTBEAT_SCHEMA_VERSION,
            heartbeatId: 'heartbeat_cli',
            enabled: true,
            updatedAt: '2026-03-01T00:00:00.000Z',
            tasks: { 'inspect-docs': { lastDryRunAt: '2026-03-01T00:00:00.000Z', lastStatus: 'needs_user_action', pendingApprovalId: seededId, pendingApprovalAt: '2026-03-01T00:00:00.000Z', lastExecStatus: 'needs_user_action' } },
          };
          await writeFile(cliStore.paths.state, `${JSON.stringify(seededState, null, 2)}\n`, 'utf-8');
          const before = await readFile(cliStore.paths.state, 'utf-8');
          const result = runNova(['heartbeat', 'approvals'], cliRoot);
          assert.equal(result.status, 0, `the approvals CLI exits 0: ${result.stderr}`);
          const ledger = JSON.parse(result.stdout ?? '{}') as { ok: boolean; count: number; approvals: Array<{ taskId: string; name?: string; pending: boolean; pendingApprovalId?: string; lastExecStatus?: string }> };
          assert.equal(ledger.ok, true, 'the approvals CLI reports ok');
          assert.equal(ledger.count, 1, 'the seeded pending approval is listed');
          assert.equal(ledger.approvals[0]!.taskId, 'inspect-docs', 'the ledger entry is the seeded task');
          assert.equal(ledger.approvals[0]!.pending, true, 'the ledger entry is pending');
          assert.equal(ledger.approvals[0]!.pendingApprovalId, seededId, 'the pending approval id survives redaction intact');
          assert.equal(ledger.approvals[0]!.lastExecStatus, 'needs_user_action', 'the ledger surfaces the execution status');
          assert.match(result.stdout ?? '', new RegExp(seededId), 'the approval id is printed verbatim (short enough to survive redaction)');
          assert.equal(await readFile(cliStore.paths.state, 'utf-8'), before, 'the approvals CLI never mutates state.json');
        } finally {
          await rm(cliRoot, { recursive: true, force: true });
        }
      }

      // ===== ADR-002 Heartbeat V3 Slice 4 — delegated execution at Gate B =====

      // D4.3 / R1 — a granted approval with NO capability wired fails closed: the
      // task is refused, nothing executes, and the grant is RETAINED so the user's
      // approval is not silently burned by a missing runtime.
      {
        const { tick, state, mintedId, calls } = await runGrantedTick(undefined);
        assert.equal(tick.tasks[0]!.status, 'refused', 'D4.3: no capability fails closed to refused');
        assert.equal(tick.status, 'refused', 'D4.3: the tick status is refused');
        assert.equal(tick.safety.autonomousActionsExecuted, false, 'D4.3: a fail-closed refusal executes nothing');
        assert.deepEqual(calls, [mintedId], 'D4.3: the granted approval is still resolved once');
        assert.equal(state!.pendingApprovalId, mintedId, 'D4.3: the grant is RETAINED for a later capable tick');
        assert.equal(state!.lastApprovalId, undefined, 'D4.3: a retained grant is not yet an audited approval');
        assert.equal(state!.lastExecAt, undefined, 'D4.3: a fail-closed refusal stamps no execution time');
        assert.equal(state!.lastExecStatus, 'refused', 'D4.3: the refusal is recorded');
      }

      // R3 — a capability that THROWS is caught at the trust boundary: the task is
      // refused, the grant is consumed (the attempt happened), and the thrown error
      // message — which carries a synthetic secret — never reaches the tick.
      {
        const { tick, state, mintedId } = await runGrantedTick(throwingCapability);
        assert.equal(tick.tasks[0]!.status, 'refused', 'R3: a thrown capability error refuses the task');
        assert.doesNotMatch(JSON.stringify(tick), new RegExp(SYNTHETIC_SECRET), 'R3: a thrown error message never leaks into the tick');
        assert.equal(state!.pendingApprovalId, undefined, 'R3: an attempted execution consumes the grant');
        assert.equal(state!.lastApprovalId, mintedId, 'R3: the attempted approval id is audited');
        assert.equal(state!.lastExecAt, undefined, 'R3: a failed attempt stamps no execution time');
      }

      // D4 ok:false — a capability that returns a non-ok outcome refuses the task
      // and consumes the grant, exactly like a throw but via the returned summary.
      {
        const { tick, state, mintedId } = await runGrantedTick(failingCapability);
        assert.equal(tick.tasks[0]!.status, 'refused', 'ok:false refuses the task');
        assert.equal(tick.safety.autonomousActionsExecuted, false, 'ok:false executes nothing');
        assert.equal(state!.pendingApprovalId, undefined, 'ok:false consumes the grant');
        assert.equal(state!.lastApprovalId, mintedId, 'ok:false audits the attempted approval id');
        assert.equal(state!.lastExecStatus, 'refused', 'ok:false records a refused execution');
      }

      // D4.5 — a successful capability executes the task: the grant is consumed,
      // the run is stamped, and a leaked secret in the outcome summary is redacted
      // out of the tick (status + bookkeeping prove success without exposing it).
      {
        const { tick, state, mintedId } = await runGrantedTick(leakyCapability);
        assert.equal(tick.tasks[0]!.status, 'executed', 'D4.5: a successful capability executes the task');
        assert.equal(tick.status, 'executed', 'D4.5: the tick status is executed');
        assert.equal(tick.dryRun, false, 'D4.5: an executed tick is not a dry run');
        assert.equal(tick.safety.autonomousActionsExecuted, true, 'D4.5: an autonomous action is recorded');
        assert.doesNotMatch(JSON.stringify(tick), new RegExp(SYNTHETIC_SECRET, 'g'), 'D4.5: the leaked summary secret is redacted from the tick');
        assert.equal(state!.pendingApprovalId, undefined, 'D4.5: a successful execution consumes the grant');
        assert.equal(state!.lastApprovalId, mintedId, 'D4.5: the executed approval id is audited');
        assert.equal(state!.lastExecAt, '2026-03-01T00:01:00.000Z', 'D4.5: lastExecAt uses the injected clock');
        assert.equal(state!.lastExecStatus, 'executed', 'D4.5: the execution status is executed');
      }

      // D4.2 — kind-independence of the dry-run path. With the master flag OFF every
      // safe kind produces a byte-identical report once volatile fields (ids, kind,
      // names, timestamps, paths) are normalized, proving the dry-run projection does
      // not branch on the task kind.
      {
        const offFlagsParity: HeartbeatExecutionFlags = { heartbeatExec: false, liveLlm: true, writeTools: true };
        const kinds: Array<HeartbeatTaskConfig['kind']> = ['inspection', 'eval', 'batch-dry-run', 'maintenance'];
        const VOLATILE_KEYS = new Set(['heartbeatId', 'tickId', 'startedAt', 'finishedAt', 'durationMs', 'paths', 'id', 'kind', 'name']);
        const normalizeKindReport = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(normalizeKindReport);
          if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
              out[key] = VOLATILE_KEYS.has(key) ? `<${key}>` : normalizeKindReport(inner);
            }
            return out;
          }
          return value;
        };
        const normalizedReports: string[] = [];
        for (const kind of kinds) {
          const kindRoot = await mkdtemp(join(tmpdir(), 'nova-heartbeat-kind-'));
          try {
            const kindConfig: HeartbeatConfig = { enabled: true, tasks: [{ id: `task-${kind}`, kind, schedule: { type: 'interval', everyMinutes: 60 } }] };
            const report = await runHeartbeatDryRunTick({ projectRoot: kindRoot, config: kindConfig, flags: offFlagsParity, sandboxAvailable: true, approvalGateway: trackingGateway('approved').gateway, now: new Date('2026-03-01T00:00:00.000Z') });
            assert.equal(report.status, 'dry_run_completed', `D4.2: ${kind} completes a dry run under master-off`);
            assert.equal(report.dryRun, true, `D4.2: ${kind} is a dry run`);
            assert.equal(report.safety.autonomousActionsExecuted, false, `D4.2: ${kind} executes nothing`);
            assert.equal(report.tasks[0]!.status, 'due', `D4.2: ${kind} is due under master-off (V2 parity)`);
            normalizedReports.push(stableStringify(normalizeKindReport(report)));
          } finally {
            await rm(kindRoot, { recursive: true, force: true });
          }
        }
        for (let i = 1; i < normalizedReports.length; i += 1) {
          assert.equal(normalizedReports[i], normalizedReports[0], `D4.2: the ${kinds[i]} dry-run report is identical to inspection once volatiles are normalized`);
        }
      }

      // D4.4 — the tool runtime's policy hook gates a delegated write. An 'ask'
      // verdict widens to allow only when approval is provided; without it the
      // wrapped tool returns the policy refusal string instead of executing.
      {
        const ask = () => ({ decision: 'ask' as const, ruleId: 'hb-d44-ask', reason: 'D4.4 forces an ask decision', safeMessage: 'D4.4 ask' });
        const probe: NovaTool = {
          name: 'hb-write-probe',
          description: 'D4.4 delegated write probe',
          inputSchema: z.object({ value: z.string() }),
          readOnly: false,
          async execute(input: { value: string }) { return `D44_OK:${input.value}`; },
        };
        const registry = new ToolRegistry();
        registry.register(probe);
        const allowed = registry.toAITools({ policy: { enabled: true, profileId: 'readonly', approvalProvided: true, hook: ask } });
        const allowedOut = await (allowed['hb-write-probe'] as any).execute({ value: 'unit' });
        assert.equal(String(allowedOut), 'D44_OK:unit', 'D4.4: an approved ask widens to allow and the tool executes');
        const refused = registry.toAITools({ policy: { enabled: true, profileId: 'readonly', hook: ask } });
        const refusedOut = await (refused['hb-write-probe'] as any).execute({ value: 'unit' });
        assert.match(String(refusedOut), /Policy ask/, 'D4.4: an un-approved ask is refused with the policy string');
      }
    }

    // ADR-002 §D5 — a V1 state file (schemaVersion 1, no execution fields) is
    // read forward: the store re-stamps schemaVersion 3, preserves lastRunAt and
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
        assert.equal(migrated.schemaVersion, 3, 'the re-stamped schema version is 3');
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
