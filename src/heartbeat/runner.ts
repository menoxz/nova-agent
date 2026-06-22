import { randomUUID } from 'node:crypto';

import type { HeartbeatConfig, HeartbeatState, HeartbeatTaskConfig, HeartbeatTaskResult, HeartbeatTickReport } from './types.js';
import { HEARTBEAT_SCHEMA_VERSION } from './types.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule, resolveHeartbeatConfig } from './config.js';
import { heartbeatTickJsonPath, heartbeatTickMarkdownPath } from './paths.js';
import { renderHeartbeatMarkdown } from './reporter.js';
import { HeartbeatStore } from './store.js';

export async function runHeartbeatDryRunTick(input: { config?: HeartbeatConfig; projectRoot?: string; now?: Date }): Promise<HeartbeatTickReport> {
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
    const tasks = resolved.tasks.map((task) => planHeartbeatTask(task, state, resolved.enabled, now));
    const finishedAtMs = Date.now();
    const report: HeartbeatTickReport = {
      schemaVersion: HEARTBEAT_SCHEMA_VERSION,
      heartbeatId: state.heartbeatId,
      tickId,
      status: tasks.some((task) => task.status === 'blocked') ? 'blocked' : 'dry_run_completed',
      dryRun: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      config: { enabled: resolved.enabled, taskCount: resolved.tasks.length },
      counts: countTasks(tasks),
      tasks,
      safety: {
        llmInvoked: false,
        toolsInvoked: false,
        autonomousActionsExecuted: false,
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
    await store.writeTick(report, renderHeartbeatMarkdown(report));
    await store.writeState(nextState(state, report));
    return report;
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

function countTasks(tasks: HeartbeatTaskResult[]): HeartbeatTickReport['counts'] {
  return {
    total: tasks.length,
    due: tasks.filter((task) => task.status === 'due').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    needsUserAction: tasks.filter((task) => task.status === 'needs_user_action').length,
  };
}

function nextState(state: HeartbeatState, report: HeartbeatTickReport): HeartbeatState {
  const tasks = { ...state.tasks };
  for (const task of report.tasks) tasks[task.id] = { ...tasks[task.id], lastDryRunAt: report.finishedAt, lastStatus: task.status };
  return { ...state, enabled: report.config.enabled, updatedAt: report.finishedAt, lastTickId: report.tickId, lastTickAt: report.finishedAt, tasks };
}
