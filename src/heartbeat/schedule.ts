import type { HeartbeatQuietWindow } from './types.js';

/**
 * Deterministic schedule math for heartbeat planning.
 *
 * Pure functions over injected epoch-millisecond inputs. No I/O, no timers,
 * no wall-clock reads. The only timezone-aware step (quiet hours) uses the
 * read-only built-in `Intl.DateTimeFormat`. This module never schedules,
 * never executes, and never imports filesystem, process, or provider APIs.
 */

/** Absolute guardrail on a projection horizon (366 days, in minutes). */
export const MAX_HORIZON_MINUTES = 366 * 24 * 60;

/** Absolute cap on projected occurrences per task. */
export const MAX_OCCURRENCES = 1000;

/** Typed failure used by the CLI to map schedule errors to usage errors. */
export class HeartbeatScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeartbeatScheduleError';
  }
}

const MS_PER_MINUTE = 60_000;
const DURATION_PATTERN = /^(\d+)([mhd]?)$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse a duration into minutes. Accepts a bare integer (= minutes) or an
 * integer with a `m`/`h`/`d` suffix. Throws `HeartbeatScheduleError` on any
 * other shape. The result is clamped to `MAX_HORIZON_MINUTES`.
 */
export function parseDurationMinutes(input: string | number): number {
  let minutes: number;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input)) {
      throw new HeartbeatScheduleError(`Invalid duration: ${input}`);
    }
    minutes = input;
  } else {
    const match = input.trim().match(DURATION_PATTERN);
    if (!match) {
      throw new HeartbeatScheduleError(`Invalid duration: "${input}"`);
    }
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'h') {
      minutes = value * 60;
    } else if (unit === 'd') {
      minutes = value * 24 * 60;
    } else {
      minutes = value;
    }
  }
  if (minutes < 1) {
    throw new HeartbeatScheduleError(`Duration must be at least 1 minute: ${String(input)}`);
  }
  return minutes > MAX_HORIZON_MINUTES ? MAX_HORIZON_MINUTES : minutes;
}

/**
 * First occurrence `>= fromMs` on the phase grid defined by `everyMin` and
 * `anchorMs` (default epoch 0). Pure modulo arithmetic.
 */
export function nextIntervalOccurrence(fromMs: number, everyMin: number, anchorMs = 0): number {
  const period = everyMin * MS_PER_MINUTE;
  if (period <= 0) {
    throw new HeartbeatScheduleError(`everyMinutes must be positive: ${everyMin}`);
  }
  const delta = fromMs - anchorMs;
  const rem = ((delta % period) + period) % period;
  return rem === 0 ? fromMs : fromMs + (period - rem);
}

export interface ProjectIntervalOptions {
  nowMs: number;
  horizonMin: number;
  everyMin: number;
  anchorMs?: number;
  maxPerTask: number;
}

/**
 * Project interval occurrences within the inclusive window
 * `[nowMs, nowMs + horizonMin]`. Length is capped at
 * `min(maxPerTask, MAX_OCCURRENCES)`.
 */
export function projectIntervalOccurrences(opts: ProjectIntervalOptions): number[] {
  const { nowMs, horizonMin, everyMin, anchorMs = 0, maxPerTask } = opts;
  const period = everyMin * MS_PER_MINUTE;
  if (period <= 0) {
    throw new HeartbeatScheduleError(`everyMinutes must be positive: ${everyMin}`);
  }
  const cap = Math.min(Math.max(0, Math.trunc(maxPerTask)), MAX_OCCURRENCES);
  if (cap === 0) {
    return [];
  }
  const endMs = nowMs + horizonMin * MS_PER_MINUTE;
  const occurrences: number[] = [];
  let cur = nextIntervalOccurrence(nowMs, everyMin, anchorMs);
  while (cur <= endMs && occurrences.length < cap) {
    occurrences.push(cur);
    cur += period;
  }
  return occurrences;
}

/** Validate and parse an `HH:MM` 24-hour clock string. Throws on invalid input. */
export function parseClockHHMM(value: string): { h: number; m: number } {
  const match = typeof value === 'string' ? value.match(CLOCK_PATTERN) : null;
  if (!match) {
    throw new HeartbeatScheduleError(`Invalid clock value (expected HH:MM): "${String(value)}"`);
  }
  return { h: Number.parseInt(match[1], 10), m: Number.parseInt(match[2], 10) };
}

function clockToMinutes(value: string): number | null {
  const match = typeof value === 'string' ? value.match(CLOCK_PATTERN) : null;
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function minutesOfDayInZone(epochMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  let h = 0;
  let m = 0;
  for (const part of parts) {
    if (part.type === 'hour') {
      h = Number.parseInt(part.value, 10);
    } else if (part.type === 'minute') {
      m = Number.parseInt(part.value, 10);
    }
  }
  if (h === 24) {
    h = 0;
  }
  return h * 60 + m;
}

/**
 * Returns the matched quiet window if `epochMs` (interpreted in `timezone`)
 * falls in a `[start, end)` window, else `null`. A window whose `start > end`
 * wraps past midnight. Read-only; no mutation.
 */
export function isInQuietHours(
  epochMs: number,
  windows: HeartbeatQuietWindow[],
  timezone: string,
): HeartbeatQuietWindow | null {
  if (!windows || windows.length === 0) {
    return null;
  }
  const minutes = minutesOfDayInZone(epochMs, timezone);
  for (const window of windows) {
    const start = clockToMinutes(window.start);
    const end = clockToMinutes(window.end);
    if (start === null || end === null || start === end) {
      continue;
    }
    const inside =
      start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (inside) {
      return window;
    }
  }
  return null;
}

/** True when `tz` is a valid IANA timezone accepted by the runtime's ICU data. */
export function validateTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) {
    return false;
  }
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return typeof formatter.resolvedOptions().timeZone === 'string';
  } catch {
    return false;
  }
}
