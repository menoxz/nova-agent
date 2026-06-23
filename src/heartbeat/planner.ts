import { createHash } from 'node:crypto';

import type {
  HeartbeatConfig,
  HeartbeatPlanOccurrence,
  HeartbeatPlanReport,
  HeartbeatPlanTask,
  HeartbeatQuietWindow,
  HeartbeatState,
  HeartbeatTaskConfig,
} from './types.js';
import { HEARTBEAT_SCHEMA_VERSION } from './types.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule, resolveHeartbeatConfig } from './config.js';
import { isInQuietHours, projectIntervalOccurrences } from './schedule.js';

/**
 * Planning-only projection for the heartbeat. Pure: every input (clock, horizon, config,
 * state) is injected; there is no I/O, no timer, no `Date.now()`, no execution, no LLM/tool
 * call, and nothing is ever scheduled. The output is a deterministic, read-only forecast of
 * which task occurrences *would* run inside the horizon.
 */

const PLAN_SAFETY_NOTES = [
  'Projection only: occurrences are computed, never executed.',
  'No LLM call, no tool call, no network, and no OS scheduler is installed by Nova.',
  'An operator must run `nova heartbeat tick --dry-run` (or install an exported manifest) to act.',
];

export interface ProjectHeartbeatPlanArgs {
  config: HeartbeatConfig | undefined;
  state: HeartbeatState;
  nowMs: number;
  horizonMinutes: number;
  maxPerTask: number;
  heartbeatId: string;
}

export function projectHeartbeatPlan(args: ProjectHeartbeatPlanArgs): HeartbeatPlanReport {
  const { config, state, nowMs, horizonMinutes, maxPerTask, heartbeatId } = args;
  const resolved = resolveHeartbeatConfig(config);
  const generatedForNow = new Date(nowMs).toISOString();
  const tasks = resolved.tasks.map((task) =>
    projectTask(task, {
      state,
      nowMs,
      horizonMinutes,
      maxPerTask,
      timezone: resolved.timezone,
      quietHours: resolved.quietHours,
    }),
  );
  const digest = configDigest(config);
  const planId = computePlanId({
    generatedForNow,
    horizonMinutes,
    maxPerTask,
    timezone: resolved.timezone,
    configDigest: digest,
  });
  return {
    schemaVersion: HEARTBEAT_SCHEMA_VERSION,
    heartbeatId,
    planId,
    generatedForNow,
    horizonMinutes,
    maxPerTask,
    timezone: resolved.timezone,
    heartbeatEnabled: resolved.enabled,
    preview: !resolved.enabled,
    counts: countPlanTasks(tasks),
    tasks,
    safety: {
      llmInvoked: false,
      toolsInvoked: false,
      autonomousActionsExecuted: false,
      schedulerInstalled: false,
      secretsIncluded: false,
      contentPolicy: 'metadata-only-redacted',
      notes: [...PLAN_SAFETY_NOTES],
    },
    paths: {
      json: `plans/${planId}.json`,
      markdown: `plans/${planId}.md`,
    },
  };
}

interface ProjectTaskContext {
  state: HeartbeatState;
  nowMs: number;
  horizonMinutes: number;
  maxPerTask: number;
  timezone: string;
  quietHours: HeartbeatQuietWindow[];
}

function projectTask(task: HeartbeatTaskConfig, ctx: ProjectTaskContext): HeartbeatPlanTask {
  const schedule = normalizeHeartbeatSchedule(task.schedule);
  const enabled = task.enabled !== false;
  const base = {
    id: task.id,
    name: task.name,
    kind: task.kind,
    action: task.action,
    enabled,
    schedule,
  } as const;

  const safety = classifyHeartbeatTaskSafety(task);
  if (safety.status === 'blocked') {
    return { ...base, status: 'blocked', reason: safety.reason, occurrences: [] };
  }
  if (safety.status === 'needs_user_action') {
    return { ...base, status: 'needs_user_action', reason: safety.reason, occurrences: [] };
  }
  if (!enabled) {
    return { ...base, status: 'skipped', reason: 'Task is disabled.', occurrences: [] };
  }
  if (schedule.type === 'manual') {
    return {
      ...base,
      status: 'manual',
      reason: 'Manual schedule: reported only, occurrences are not projected.',
      occurrences: [],
    };
  }
  if (schedule.type === 'interval') {
    const everyMinutes = schedule.everyMinutes ?? 0;
    if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
      return { ...base, status: 'blocked', reason: 'Interval schedule requires everyMinutes > 0.', occurrences: [] };
    }
    const anchorMs = resolveAnchorMs(schedule.anchor, ctx.state.tasks[task.id]?.lastRunAt, ctx.nowMs);
    const occurrenceMs = projectIntervalOccurrences({
      nowMs: ctx.nowMs,
      horizonMin: ctx.horizonMinutes,
      everyMin: everyMinutes,
      anchorMs,
      maxPerTask: ctx.maxPerTask,
    });
    const occurrences = occurrenceMs.map((ms) => classifyOccurrence(ms, ctx.quietHours, ctx.timezone));
    const firstDueAt = occurrences.find((occ) => occ.classification === 'would_run')?.at;
    return {
      ...base,
      status: 'projected',
      reason: `Projected interval occurrences every ${everyMinutes} minutes (read-only).`,
      firstDueAt,
      occurrences,
    };
  }
  return {
    ...base,
    status: 'blocked',
    reason: `Unsupported schedule type "${(schedule as { type?: string }).type ?? 'unknown'}".`,
    occurrences: [],
  };
}

/** Anchor precedence: explicit `schedule.anchor` → stored `lastRunAt` → `nowMs`. */
function resolveAnchorMs(anchor: string | undefined, lastRunAt: string | undefined, nowMs: number): number {
  for (const candidate of [anchor, lastRunAt]) {
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return nowMs;
}

function classifyOccurrence(ms: number, quietHours: HeartbeatQuietWindow[], timezone: string): HeartbeatPlanOccurrence {
  const at = new Date(ms).toISOString();
  const window = isInQuietHours(ms, quietHours, timezone);
  if (window) {
    return { at, classification: 'quiet_hours', note: `Suppressed by quiet window ${window.start}-${window.end}.` };
  }
  return { at, classification: 'would_run' };
}

function countPlanTasks(tasks: HeartbeatPlanTask[]): HeartbeatPlanReport['counts'] {
  let occurrences = 0;
  let quietHours = 0;
  for (const task of tasks) {
    occurrences += task.occurrences.length;
    for (const occ of task.occurrences) {
      if (occ.classification === 'quiet_hours') {
        quietHours += 1;
      }
    }
  }
  return {
    tasks: tasks.length,
    projected: tasks.filter((task) => task.status === 'projected').length,
    quietHours,
    manual: tasks.filter((task) => task.status === 'manual').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    needsUserAction: tasks.filter((task) => task.status === 'needs_user_action').length,
    occurrences,
  };
}

export interface PlanIdInputs {
  generatedForNow: string;
  horizonMinutes: number;
  maxPerTask: number;
  timezone: string;
  configDigest: string;
}

/**
 * Deterministic plan id. `plan_` + first 16 hex of sha256 over the projection inputs.
 * Never reads the wall clock and never uses randomness, so identical inputs ⇒ identical id.
 * `heartbeatId` is intentionally excluded so the id is stable across heartbeat instances.
 */
export function computePlanId(inputs: PlanIdInputs): string {
  const payload = [
    inputs.generatedForNow,
    String(inputs.horizonMinutes),
    String(inputs.maxPerTask),
    inputs.timezone,
    inputs.configDigest,
  ].join('|');
  return `plan_${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

/** Stable (sorted-key) JSON digest of a config, so identical configs share a planId. */
export function configDigest(config: HeartbeatConfig | undefined): string {
  return createHash('sha256').update(stableStringify(config ?? {})).digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
