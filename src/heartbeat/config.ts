import type { HeartbeatConfig, HeartbeatTaskConfig, HeartbeatTaskAction, HeartbeatTaskKind, HeartbeatScheduleConfig, HeartbeatQuietWindow } from './types.js';
import { parseClockHHMM, validateTimezone } from './schedule.js';

const SAFE_KINDS = new Set(['inspection', 'eval', 'batch-dry-run', 'maintenance']);
const SAFE_ACTIONS = new Set(['inspect', 'eval', 'batch-dry-run', 'maintain']);
const DANGEROUS = new Set(['shell', 'write', 'git', 'network', 'memory-write', 'auto-resume']);

export interface ResolvedHeartbeatConfig {
  enabled: boolean;
  tasks: HeartbeatTaskConfig[];
  timezone: string;
  quietHours: HeartbeatQuietWindow[];
}

export interface HeartbeatSafetyDecision {
  status: 'ok' | 'blocked' | 'needs_user_action';
  reason: string;
}

export function resolveHeartbeatConfig(config?: HeartbeatConfig): ResolvedHeartbeatConfig {
  const timezone = config?.timezone && validateTimezone(config.timezone) ? config.timezone : 'UTC';
  const quietHours = (config?.quietHours ?? []).filter(isValidQuietWindow);
  return {
    enabled: config?.enabled === true,
    tasks: config?.tasks ?? [],
    timezone,
    quietHours,
  };
}

function isValidQuietWindow(window: HeartbeatQuietWindow): boolean {
  try {
    parseClockHHMM(window.start);
    parseClockHHMM(window.end);
    return true;
  } catch {
    return false;
  }
}

export function normalizeHeartbeatSchedule(schedule?: HeartbeatScheduleConfig): HeartbeatScheduleConfig {
  return schedule ?? { type: 'manual' };
}

export function classifyHeartbeatTaskSafety(task: HeartbeatTaskConfig): HeartbeatSafetyDecision {
  const kind = task.kind.trim();
  const action = task.action?.trim();
  if (!kind) return { status: 'blocked', reason: 'Task kind is empty.' };
  if (DANGEROUS.has(kind)) return { status: 'blocked', reason: `Dangerous task kind "${kind}" is not supported by Heartbeat V1.` };
  if (action && DANGEROUS.has(action)) return { status: 'blocked', reason: `Dangerous action "${action}" is not supported by Heartbeat V1.` };
  if (!SAFE_KINDS.has(kind)) return { status: 'blocked', reason: `Unsupported task kind "${kind}". V1 recognizes inspection, eval, batch-dry-run and maintenance only.` };
  if (action && !SAFE_ACTIONS.has(action)) return { status: 'needs_user_action', reason: `Unsupported action "${action}" requires explicit user review; V1 only plans safe dry-runs.` };
  return { status: 'ok', reason: 'Recognized safe planning kind; V1 will not execute it.' };
}

export function isHeartbeatDangerousKind(value: HeartbeatTaskKind | HeartbeatTaskAction): boolean {
  return DANGEROUS.has(value);
}
