import { randomUUID } from 'node:crypto';

import type { HeartbeatConfig, HeartbeatState, HeartbeatTaskConfig, HeartbeatTaskResult, HeartbeatTaskState, HeartbeatTickReport, HeartbeatTickStatus } from './types.js';
import { HEARTBEAT_SCHEMA_VERSION } from './types.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule, resolveHeartbeatConfig } from './config.js';
import type { HeartbeatExecutionFlags } from './execution_gate.js';
import { readHeartbeatExecutionFlags } from './execution_gate.js';
import type { HeartbeatApprovalGateway, HeartbeatApprovalPatch } from './executor.js';
import { applyHeartbeatApprovalPatch, createReadOnlyApprovalGateway, evaluateHeartbeatExecution } from './executor.js';
import { probeExecutionSandbox } from '../sandbox/probe.js';
import { heartbeatTickJsonPath, heartbeatTickMarkdownPath } from './paths.js';
import { renderHeartbeatMarkdown } from './reporter.js';
import { safeHeartbeatReport } from './redaction.js';
import { HeartbeatStore } from './store.js';

export async function runHeartbeatDryRunTick(input: {
  config?: HeartbeatConfig;
  projectRoot?: string;
  now?: Date;
  flags?: HeartbeatExecutionFlags;
  sandboxAvailable?: boolean;
  approvalGateway?: HeartbeatApprovalGateway;
}): Promise<HeartbeatTickReport> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const now = input.now ?? new Date();
  const resolved = resolveHeartbeatConfig(input.config);
  const store = new HeartbeatStore(projectRoot);
  return store.withLock(async () => {
    const state = await store.readState(resolved.enabled);
    const startedAtMs = Date.now();
    const startedAt = now.toISOString();
    const tickId = `heartbeat_tick_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const paths = { json: heartbeatTickJsonPath(tickId, projectRoot), markdown: heartbeatTickMarkdownPath(tickId, projectRoot) };
    // Execution seams default to OFF flags / sandbox probe / zero-I/O gateway.
    // Tests inject these to drive the cross-tick approval lifecycle offline and
    // deterministically (a fixed `now` plus a stubbed approval verdict).
    const flags = input.flags ?? readHeartbeatExecutionFlags();
    const sandboxAvailable = input.sandboxAvailable ?? (probeExecutionSandbox()?.available === true);
    const gateway = input.approvalGateway ?? createReadOnlyApprovalGateway();
    const evaluations = await Promise.all(
      resolved.tasks.map((task) =>
        evaluateHeartbeatExecution({
          planned: planHeartbeatTask(task, state, resolved.enabled, now),
          task,
          taskState: state.tasks[task.id],
          flags,
          sandboxAvailable,
          gateway,
          now,
        }),
      ),
    );
    const tasks = evaluations.map((evaluation) => evaluation.result);
    const approvalPatches = new Map<string, HeartbeatApprovalPatch>(
      evaluations.map((evaluation) => [evaluation.result.id, evaluation.patch]),
    );
    const executed = tasks.some((task) => task.status === 'executed');
    const finishedAtMs = Date.now();
    const report: HeartbeatTickReport = {
      schemaVersion: HEARTBEAT_SCHEMA_VERSION,
      heartbeatId: state.heartbeatId,
      tickId,
      status: tickStatus(tasks),
      dryRun: !executed,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      config: { enabled: resolved.enabled, taskCount: resolved.tasks.length },
      counts: countTasks(tasks),
      tasks,
      safety: {
        llmInvoked: false,
        toolsInvoked: false,
        autonomousActionsExecuted: executed,
        secretsIncluded: false,
        contentPolicy: 'metadata-only-redacted',
        notes: [
          'Dry-run only: tasks are classified and scheduled, never executed.',
          'Dangerous write/shell/git/network/memory/auto-resume actions are blocked.',
          'Reports include metadata only; no prompts, secrets or raw .nova artifacts are copied.',
        ],
      },
      paths,
    };
    const safeReport = safeHeartbeatReport(report);
    await store.writeTick(safeReport, renderHeartbeatMarkdown(safeReport), paths);
    await store.writeState(nextState(state, report, approvalPatches));
    return safeReport;
  });
}

export function planHeartbeatTask(task: HeartbeatTaskConfig, state: HeartbeatState, heartbeatEnabled: boolean, now: Date): HeartbeatTaskResult {
  const schedule = normalizeHeartbeatSchedule(task.schedule);
  const enabled = task.enabled !== false;
  const taskState = state.tasks[task.id];
  const lastRunAt = taskState?.lastRunAt;
  const base = { id: task.id, name: task.name, kind: task.kind, action: task.action, enabled, schedule, lastRunAt };
  const safety = classifyHeartbeatTaskSafety(task);
  if (safety.status !== 'ok') return { ...base, status: safety.status, reason: safety.reason };
  if (!heartbeatEnabled) return { ...base, status: 'skipped', reason: 'Heartbeat is disabled by config (default).' };
  if (!enabled) return { ...base, status: 'skipped', reason: 'Task is disabled.' };
  if (schedule.type === 'manual') return { ...base, status: 'skipped', reason: 'Manual schedule: only reported, never auto-started.' };
  if (schedule.type === 'interval') {
    const everyMinutes = schedule.everyMinutes ?? 0;
    if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) return { ...base, status: 'blocked', reason: 'Interval schedule requires everyMinutes > 0.' };
    if (!lastRunAt) return { ...base, status: 'due', reason: 'Interval task has no lastRunAt in heartbeat state.' };
    const last = Date.parse(lastRunAt);
    if (!Number.isFinite(last)) return { ...base, status: 'due', reason: 'Stored lastRunAt is invalid; task is due for user review.' };
    const nextDue = new Date(last + everyMinutes * 60_000);
    if (nextDue.getTime() <= now.getTime()) return { ...base, status: 'due', reason: `Interval elapsed (${everyMinutes} minutes).`, nextDueAt: nextDue.toISOString() };
    return { ...base, status: 'skipped', reason: `Not due until ${nextDue.toISOString()}.`, nextDueAt: nextDue.toISOString() };
  }
  return { ...base, status: 'blocked', reason: `Unsupported schedule type "${(schedule as { type?: string }).type ?? 'unknown'}".` };
}

function tickStatus(tasks: HeartbeatTaskResult[]): HeartbeatTickStatus {
  if (tasks.some((task) => task.status === 'executed')) return 'executed';
  if (tasks.some((task) => task.status === 'refused')) return 'refused';
  if (tasks.some((task) => task.status === 'blocked')) return 'blocked';
  return 'dry_run_completed';
}

function countTasks(tasks: HeartbeatTaskResult[]): HeartbeatTickReport['counts'] {
  return {
    total: tasks.length,
    due: tasks.filter((task) => task.status === 'due').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    needsUserAction: tasks.filter((task) => task.status === 'needs_user_action').length,
  };
}

function nextState(state: HeartbeatState, report: HeartbeatTickReport, patches: Map<string, HeartbeatApprovalPatch>): HeartbeatState {
  const tasks = { ...state.tasks };
  for (const task of report.tasks) {
    // V2 bookkeeping (lastDryRunAt/lastStatus) is layered first; the approval
    // patch then applies the ADR-002 execution/approval fields on top. With
    // execution flags OFF every patch is 'none', so the result is byte-identical
    // to V2 (SI-1). Exec/expiry timestamps inside the patch use the injected
    // `now`; lastDryRunAt stays report.finishedAt for V2 parity.
    const base: HeartbeatTaskState = { ...tasks[task.id], lastDryRunAt: report.finishedAt, lastStatus: task.status };
    tasks[task.id] = applyHeartbeatApprovalPatch(base, patches.get(task.id) ?? { kind: 'none' });
  }
  return { ...state, enabled: report.config.enabled, updatedAt: report.finishedAt, lastTickId: report.tickId, lastTickAt: report.finishedAt, tasks };
}
