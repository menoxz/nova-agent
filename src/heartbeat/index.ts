import { relative } from 'node:path';

import type { ProjectConfigLoadResult } from '../config/project.js';
import { readProjectConfig } from '../config/project.js';
import { resolveHeartbeatConfig } from './config.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule } from './config.js';
import { HeartbeatStore } from './store.js';
import { runHeartbeatDryRunTick } from './runner.js';
import { readHeartbeatExecutionFlags } from './execution_gate.js';
import { createHeartbeatApprovalBridge } from '../autoexec/approval_gateway.js';
import { projectHeartbeatPlan } from './planner.js';
import { buildAutomationManifest, defaultTickEveryMinutes } from './automation.js';
import { HeartbeatScheduleError, parseDurationMinutes } from './schedule.js';
import { resolveAutomationOutPath } from './paths.js';
import {
  safeHeartbeatManifest,
  safeHeartbeatPath,
  safeHeartbeatPlanReport,
  safeHeartbeatReport,
  safeHeartbeatTaskResult,
  safeHeartbeatText,
} from './redaction.js';
import type { HeartbeatAutomationManifest, HeartbeatAutomationTarget, HeartbeatConfig, HeartbeatPlanReport, HeartbeatTickReport } from './types.js';

export * from './types.js';
export * from './config.js';
export * from './schedule.js';
export * from './paths.js';
export * from './planner.js';
export * from './automation.js';
export * from './store.js';
export * from './runner.js';
export * from './execution_gate.js';
export * from './executor.js';
export * from './reporter.js';
export * from './redaction.js';

export async function handleHeartbeatCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'heartbeat') return false;
  const project = readProjectConfig();
  if (action === 'validate') return printHeartbeatValidate(project);
  if (action === 'status') return printHeartbeatStatus(project);
  if (action === 'tasks') return printHeartbeatTasks(project);
  if (action === 'approvals') return printHeartbeatApprovals(project);
  if (action === 'tick') return runHeartbeatTickCli(project, rest);
  if (action === 'plan') return runHeartbeatPlanCli(project, rest);
  if (action === 'automation' && rest[0] === 'export') return runHeartbeatAutomationExportCli(project, rest.slice(1));
  if (action === 'automation') {
    return heartbeatUsageError('Missing subcommand. Usage: nova heartbeat automation export --target <windows-task|systemd|cron> [--every <dur> | --at <HH:MM>]');
  }
  if (action === 'report' && rest[0] === 'latest') return printLatestHeartbeatReport();
  if (action === 'report') return heartbeatUsageError('Missing argument. Usage: nova heartbeat report latest');
  return heartbeatUsageError(`Unknown heartbeat command: ${args.join(' ') || 'heartbeat'}`);
}

function heartbeatConfigFrom(project: ProjectConfigLoadResult): HeartbeatConfig | undefined {
  return project.ok ? project.config?.heartbeat : undefined;
}

function printHeartbeatValidate(project: ProjectConfigLoadResult): true {
  const heartbeat = resolveHeartbeatConfig(heartbeatConfigFrom(project));
  const tasks = heartbeat.tasks.map((task) => ({
    safety: classifyHeartbeatTaskSafety(task),
    task,
  })).map(({ task, safety }) => ({
    id: safeHeartbeatText(task.id),
    name: safeHeartbeatText(task.name),
    kind: safeHeartbeatText(task.kind),
    action: safeHeartbeatText(task.action),
    enabled: task.enabled !== false,
    schedule: normalizeHeartbeatSchedule(task.schedule),
    safety: { ...safety, reason: safeHeartbeatText(safety.reason) },
  }));
  console.log(JSON.stringify({ path: safeHeartbeatPath(project.path), present: project.present, ok: project.ok, errors: project.errors.map((error) => safeHeartbeatText(error)), heartbeat: { ...heartbeat, tasks } }, null, 2));
  process.exitCode = project.ok ? 0 : 1;
  return true;
}

async function printHeartbeatStatus(project: ProjectConfigLoadResult): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const heartbeat = resolveHeartbeatConfig(project.config?.heartbeat);
  const store = new HeartbeatStore();
  const state = await store.readState(heartbeat.enabled);
  console.log(JSON.stringify({ ok: true, enabled: heartbeat.enabled, taskCount: heartbeat.tasks.length, statePath: safeHeartbeatPath(store.paths.state), ticksDir: safeHeartbeatPath(store.paths.ticks), lockPath: safeHeartbeatPath(store.paths.lock), lastTickId: safeHeartbeatText(state.lastTickId), lastTickAt: state.lastTickAt }, null, 2));
  return true;
}

async function printHeartbeatTasks(project: ProjectConfigLoadResult): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const heartbeat = resolveHeartbeatConfig(project.config?.heartbeat);
  const store = new HeartbeatStore();
  const state = await store.readState(heartbeat.enabled);
  const { planHeartbeatTask } = await import('./runner.js');
  console.log(JSON.stringify({ ok: true, enabled: heartbeat.enabled, tasks: heartbeat.tasks.map((task) => safeHeartbeatTaskResult(planHeartbeatTask(task, state, heartbeat.enabled, new Date()))) }, null, 2));
  return true;
}

/**
 * `nova heartbeat approvals` — read-only view of the cross-tick approval ledger
 * persisted under `.nova/heartbeat/state.json`. It NEVER reads `.nova/sessions/`,
 * never decides an approval, and never writes state. Every approval id and path
 * is redacted before printing (heartbeat ids are short enough to survive intact).
 */
async function printHeartbeatApprovals(project: ProjectConfigLoadResult): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const heartbeat = resolveHeartbeatConfig(project.config?.heartbeat);
  const store = new HeartbeatStore();
  const state = await store.readState(heartbeat.enabled);
  const names = new Map(heartbeat.tasks.map((task) => [task.id, task.name]));
  const approvals = Object.entries(state.tasks)
    .filter(([, task]) => task.pendingApprovalId !== undefined || task.lastApprovalId !== undefined || task.lastExecStatus !== undefined)
    .map(([id, task]) => ({
      taskId: safeHeartbeatText(id),
      name: safeHeartbeatText(names.get(id)),
      pending: task.pendingApprovalId !== undefined,
      pendingApprovalId: safeHeartbeatText(task.pendingApprovalId),
      pendingApprovalAt: task.pendingApprovalAt,
      lastApprovalId: safeHeartbeatText(task.lastApprovalId),
      lastExecStatus: task.lastExecStatus,
      lastExecAt: task.lastExecAt,
    }));
  console.log(JSON.stringify({ ok: true, enabled: heartbeat.enabled, statePath: safeHeartbeatPath(store.paths.state), count: approvals.length, approvals }, null, 2));
  return true;
}

async function runHeartbeatTickCli(project: ProjectConfigLoadResult, rest: string[]): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  if (!rest.includes('--dry-run')) return heartbeatUsageError('Heartbeat V2 supports only explicit dry-run ticks. Usage: nova heartbeat tick --dry-run');
  try {
    const report = await runHeartbeatTickReport(project.config?.heartbeat);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } catch (err) {
    console.error(`Heartbeat tick failed: ${safeHeartbeatText(err instanceof Error ? err.message : String(err))}`);
    process.exitCode = 1;
  }
  return true;
}

/**
 * Resolve a heartbeat tick report for the CLI. With execution disarmed (master
 * flag NOVA_ENABLE_HEARTBEAT_EXEC off — the default) this is a pure dry-run tick:
 * no session bridge is constructed and no .nova/sessions/ I/O happens, so the
 * report is byte-identical to V2 (parity SI-1). With execution armed the CLI
 * builds the session approval bridge for this project and injects its
 * gateway/requester/capability ports, so a real session approval can drive Gate B
 * across ticks. The bridge (src/autoexec/**) is the ONLY place .nova/sessions/ is
 * touched; the heartbeat core never imports session machinery.
 */
async function runHeartbeatTickReport(config: HeartbeatConfig | undefined): Promise<HeartbeatTickReport> {
  const flags = readHeartbeatExecutionFlags();
  if (!flags.heartbeatExec) return runHeartbeatDryRunTick({ config });
  const bridge = createHeartbeatApprovalBridge({ projectRoot: process.cwd() });
  return runHeartbeatDryRunTick({
    config,
    flags,
    approvalGateway: bridge.gateway,
    approvalRequester: bridge.requester,
    capability: bridge.capability,
  });
}

async function printLatestHeartbeatReport(): Promise<true> {
  const report = await new HeartbeatStore().latestTickReport();
  if (!report) {
    console.error('No heartbeat reports found. Run `nova heartbeat tick --dry-run` first; V2 never starts a daemon automatically.');
    process.exitCode = 1;
    return true;
  }
  console.log(JSON.stringify(safeHeartbeatReport(report), null, 2));
  return true;
}

function printInvalidProject(project: ProjectConfigLoadResult): true {
  console.error(`Invalid Nova project config at ${safeHeartbeatPath(project.path)}: ${project.errors.map((error) => safeHeartbeatText(error)).join('; ')}`);
  process.exitCode = 1;
  return true;
}

function heartbeatUsageError(message: string): true {
  console.error(message);
  console.error('Run `nova heartbeat --help` for supported V2 commands.');
  process.exitCode = 1;
  return true;
}

const DEFAULT_PLAN_HORIZON = '6h';
const DEFAULT_PLAN_MAX = 50;

/**
 * `nova heartbeat plan` — pure, read-only projection. Never mutates `state.json`,
 * never executes a task, never schedules anything. Persists a redacted plan under
 * `.nova/heartbeat/plans/<planId>.{json,md}` with a deterministic `planId`.
 */
async function runHeartbeatPlanCli(project: ProjectConfigLoadResult, rest: string[]): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  try {
    const config = project.config?.heartbeat;
    const resolved = resolveHeartbeatConfig(config);
    const nowMs = resolvePlanNow(readFlagValue(rest, '--now'));
    const horizonMinutes = parseDurationMinutes(readFlagValue(rest, '--horizon') ?? DEFAULT_PLAN_HORIZON);
    const maxPerTask = resolvePlanMax(readFlagValue(rest, '--max'));
    const store = new HeartbeatStore();
    const state = await store.readState(resolved.enabled);
    const report = safeHeartbeatPlanReport(
      projectHeartbeatPlan({ config, state, nowMs, horizonMinutes, maxPerTask, heartbeatId: state.heartbeatId }),
    );
    await store.writePlanReport(report);
    if (rest.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printPlanHuman(report);
    }
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof HeartbeatScheduleError) {
      return heartbeatUsageError(`Heartbeat plan: ${safeHeartbeatText(err.message) ?? 'invalid input'}`);
    }
    console.error(`Heartbeat plan failed: ${safeHeartbeatText(err instanceof Error ? err.message : String(err))}`);
    process.exitCode = 1;
  }
  return true;
}

function printPlanHuman(report: HeartbeatPlanReport): void {
  console.log(`Heartbeat plan ${report.planId} — preview=${report.preview}, horizon=${report.horizonMinutes}m, max=${report.maxPerTask}, timezone=${report.timezone}.`);
  console.log(
    `Tasks ${report.counts.tasks} (projected ${report.counts.projected}, manual ${report.counts.manual}, skipped ${report.counts.skipped}, blocked ${report.counts.blocked}, needs_user_action ${report.counts.needsUserAction}); occurrences ${report.counts.occurrences} (quiet_hours ${report.counts.quietHours}).`,
  );
  console.log(`Wrote ${report.paths.json} and ${report.paths.markdown} (read-only projection; Nova does not schedule itself).`);
}

function resolvePlanNow(raw: string | undefined): number {
  if (raw === undefined) return Date.now();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new HeartbeatScheduleError(`Invalid --now timestamp (expected ISO-8601): "${raw}"`);
  }
  return parsed;
}

function resolvePlanMax(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PLAN_MAX;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HeartbeatScheduleError(`Invalid --max (expected a positive integer): "${raw}"`);
  }
  return parsed;
}

/**
 * `nova heartbeat automation export` — emit an INERT operator manifest that invokes only
 * `nova heartbeat tick --dry-run`. Nothing is installed or scheduled. Writes stay under
 * `.nova/heartbeat/automation/`; `--stdout` writes no file; `--out` escaping the sandbox
 * exits 1 with no file and never echoes the resolved absolute path.
 */
async function runHeartbeatAutomationExportCli(project: ProjectConfigLoadResult, rest: string[]): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const target = readFlagValue(rest, '--target');
  if (!isAutomationTarget(target)) {
    return heartbeatUsageError('Heartbeat automation export requires --target <windows-task|systemd|cron>.');
  }
  const asJson = rest.includes('--json');
  const toStdout = rest.includes('--stdout');
  try {
    const config = project.config?.heartbeat;
    const resolved = resolveHeartbeatConfig(config);
    const atRaw = readFlagValue(rest, '--at');
    const everyRaw = readFlagValue(rest, '--every');
    let tickAt: string | undefined;
    let tickEveryMinutes: number | undefined;
    if (typeof atRaw === 'string') {
      tickAt = atRaw;
    } else if (typeof everyRaw === 'string') {
      tickEveryMinutes = parseDurationMinutes(everyRaw);
    } else {
      tickEveryMinutes = defaultTickEveryMinutes(config);
    }
    const manifest = safeHeartbeatManifest(
      buildAutomationManifest({ target, tickEveryMinutes, tickAt, timezone: resolved.timezone }),
    );
    if (toStdout) {
      console.log(asJson ? JSON.stringify(manifest, null, 2) : manifest.body);
      process.exitCode = 0;
      return true;
    }
    const store = new HeartbeatStore();
    let outPath: string | undefined;
    const outRaw = readFlagValue(rest, '--out');
    if (typeof outRaw === 'string' && outRaw.length > 0) {
      try {
        outPath = resolveAutomationOutPath(store.paths.root, outRaw);
      } catch {
        return heartbeatUsageError('Heartbeat automation --out must be a relative path that stays under .nova/heartbeat/.');
      }
    }
    const file = await store.writeAutomationManifest(manifest, outPath);
    const persisted: HeartbeatAutomationManifest = {
      ...manifest,
      paths: { file: safeHeartbeatPath(relative(store.paths.root, file)) },
    };
    if (asJson) {
      console.log(JSON.stringify(persisted, null, 2));
    } else {
      console.log(`Wrote inert ${target} automation manifest (installed=false, invokes \`nova heartbeat tick --dry-run\`; Nova does not schedule itself).`);
      console.log(persisted.body);
    }
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof HeartbeatScheduleError) {
      return heartbeatUsageError(`Heartbeat automation export: ${safeHeartbeatText(err.message) ?? 'invalid schedule'}`);
    }
    console.error(`Heartbeat automation export failed: ${safeHeartbeatText(err instanceof Error ? err.message : String(err))}`);
    process.exitCode = 1;
  }
  return true;
}

function readFlagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

function isAutomationTarget(value: string | undefined): value is HeartbeatAutomationTarget {
  return value === 'windows-task' || value === 'systemd' || value === 'cron';
}
