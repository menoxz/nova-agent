import type {
  HeartbeatAutomationManifest,
  HeartbeatAutomationTarget,
  HeartbeatConfig,
} from './types.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule, resolveHeartbeatConfig } from './config.js';
import { HeartbeatScheduleError, parseClockHHMM } from './schedule.js';

/**
 * Operator-facing automation manifests for the heartbeat.
 *
 * Pure builders: every manifest is INERT. Nothing here installs, schedules,
 * or executes anything — there is no timer, no subprocess, no background loop, no
 * wall-clock read. A manifest is just text an operator may review and install by
 * hand. Every manifest invokes a single read-only command:
 * `nova heartbeat tick --dry-run`, and uses `<PROJECT_DIR>` / `<NOVA_BIN>`
 * placeholders so no absolute path or secret ever leaks into the artifact.
 */

/** Placeholder for the project directory; operators substitute their own path. */
const PROJECT_DIR_PLACEHOLDER = '<PROJECT_DIR>';
/** Placeholder for the nova binary; operators substitute their own path. */
const NOVA_BIN_PLACEHOLDER = '<NOVA_BIN>';
/** The only command any exported manifest ever invokes. */
const DRY_RUN_COMMAND = 'nova heartbeat tick --dry-run';

/** Lower/upper clamp and fallback for the auto-derived default tick interval. */
const MIN_DEFAULT_EVERY_MINUTES = 5;
const MAX_DEFAULT_EVERY_MINUTES = 1440;
const FALLBACK_EVERY_MINUTES = 15;

const BANNER_LINES = [
  'Nova heartbeat — operator-managed automation manifest (INERT, NOT INSTALLED).',
  'Nova does not schedule itself. Review this manifest, then install it manually if you choose.',
  `It invokes a read-only dry run only: ${DRY_RUN_COMMAND}`,
  `Replace ${PROJECT_DIR_PLACEHOLDER} with your project directory and ${NOVA_BIN_PLACEHOLDER} with the nova binary path.`,
];

/** Single-line banner asserting the manifest is inert and never self-scheduling. */
export const AUTOMATION_BANNER = BANNER_LINES.join(' ');

interface AutomationSchedule {
  kind: 'interval' | 'daily';
  everyMinutes?: number;
  at?: { h: number; m: number };
}

export interface BuildAutomationManifestArgs {
  target: HeartbeatAutomationTarget;
  tickEveryMinutes?: number;
  tickAt?: string;
  timezone: string;
}

/**
 * Build an inert automation manifest for the given target. Provide exactly one
 * cadence: `tickAt` (`HH:MM`, daily) takes precedence over `tickEveryMinutes`
 * (interval). Throws `HeartbeatScheduleError` if neither is usable. The result
 * never installs anything (`installed: false`) and only ever invokes the
 * read-only dry run.
 */
export function buildAutomationManifest(args: BuildAutomationManifestArgs): HeartbeatAutomationManifest {
  const schedule = resolveSchedule(args.tickEveryMinutes, args.tickAt);
  const body = renderBody(args.target, schedule);
  const manifest: HeartbeatAutomationManifest = {
    target: args.target,
    timezone: args.timezone,
    invokes: DRY_RUN_COMMAND,
    installed: false,
    body,
    paths: {},
  };
  if (schedule.kind === 'interval' && typeof schedule.everyMinutes === 'number') {
    manifest.tickEveryMinutes = schedule.everyMinutes;
  } else if (schedule.kind === 'daily' && schedule.at) {
    manifest.tickAt = formatClock(schedule.at);
  }
  return manifest;
}

function resolveSchedule(tickEveryMinutes: number | undefined, tickAt: string | undefined): AutomationSchedule {
  if (typeof tickAt === 'string' && tickAt.length > 0) {
    return { kind: 'daily', at: parseClockHHMM(tickAt) };
  }
  if (typeof tickEveryMinutes === 'number' && Number.isFinite(tickEveryMinutes) && tickEveryMinutes > 0) {
    const everyMinutes = Math.trunc(tickEveryMinutes);
    assertRepresentableInterval(everyMinutes);
    return { kind: 'interval', everyMinutes };
  }
  throw new HeartbeatScheduleError('Automation export requires either --at <HH:MM> or --every <duration>.');
}

/**
 * Single consistency gate for automation intervals. Accepts only cadences that
 * cron, systemd, AND windows can all express identically: 1–59 minutes, whole
 * hours (60..1380 in steps of 60 = up to 23h), or exactly 1440 (daily). Every
 * other value (e.g. 90, 1439, 1500) is rejected uniformly BEFORE any renderer
 * runs, so the three exported manifests always carry the same meaning. Pure:
 * no clock, no I/O.
 */
function assertRepresentableInterval(n: number): void {
  const ok =
    (n >= 1 && n <= 59) ||
    (n % 60 === 0 && n / 60 >= 1 && n / 60 <= 23) ||
    n === 1440;
  if (!ok) {
    throw new HeartbeatScheduleError(
      `Unsupported heartbeat interval: ${n} minute(s). ` +
        `Representable cadences are 1-59 minutes, whole hours (60..1380 in steps of 60 = up to 23h), ` +
        `or exactly 1440 (daily). For other daily times use --at HH:MM.`,
    );
  }
}

/**
 * Derive a sensible default tick interval (minutes) from the heartbeat config:
 * the smallest interval among enabled, safe, interval tasks, clamped to
 * `[5, 1440]`. Falls back to 15 when no such task exists. Pure: read-only over
 * the config, no clock, no I/O.
 */
export function defaultTickEveryMinutes(config?: HeartbeatConfig): number {
  const resolved = resolveHeartbeatConfig(config);
  let best: number | undefined;
  for (const task of resolved.tasks) {
    if (task.enabled === false) {
      continue;
    }
    if (classifyHeartbeatTaskSafety(task).status !== 'ok') {
      continue;
    }
    const schedule = normalizeHeartbeatSchedule(task.schedule);
    if (schedule.type !== 'interval') {
      continue;
    }
    const every = schedule.everyMinutes;
    if (typeof every !== 'number' || !Number.isFinite(every) || every <= 0) {
      continue;
    }
    const truncated = Math.trunc(every);
    if (best === undefined || truncated < best) {
      best = truncated;
    }
  }
  const chosen = best ?? FALLBACK_EVERY_MINUTES;
  return Math.min(Math.max(chosen, MIN_DEFAULT_EVERY_MINUTES), MAX_DEFAULT_EVERY_MINUTES);
}

function renderBody(target: HeartbeatAutomationTarget, schedule: AutomationSchedule): string {
  switch (target) {
    case 'cron':
      return renderCron(schedule);
    case 'systemd':
      return renderSystemd(schedule);
    case 'windows-task':
      return renderWindows(schedule);
    default:
      throw new HeartbeatScheduleError(`Unsupported automation target "${String(target)}".`);
  }
}

function renderCron(schedule: AutomationSchedule): string {
  const command = `cd ${PROJECT_DIR_PLACEHOLDER} && ${NOVA_BIN_PLACEHOLDER} heartbeat tick --dry-run`;
  const lines = [
    ...commentBlock('#'),
    `${cronSpec(schedule)} ${command}`,
    '',
  ];
  return lines.join('\n');
}

function cronSpec(schedule: AutomationSchedule): string {
  if (schedule.kind === 'daily' && schedule.at) {
    return `${schedule.at.m} ${schedule.at.h} * * *`;
  }
  if (schedule.kind === 'interval' && schedule.everyMinutes) {
    const n = schedule.everyMinutes; // gate-validated upstream: 1..59 ∪ {60,120,…,1380} ∪ {1440}
    if (n < 60) {
      return `*/${n} * * * *`; // 1..59 minutes
    }
    if (n < 1440) {
      return `0 */${n / 60} * * *`; // whole hours 1..23
    }
    return '0 0 * * *'; // n === 1440 -> daily 00:00
  }
  throw new HeartbeatScheduleError('Invalid automation schedule.');
}

function renderSystemd(schedule: AutomationSchedule): string {
  const lines = [
    ...commentBlock('#', [
      'Save the [Unit]/[Timer] section as nova-heartbeat.timer and the [Service] section as nova-heartbeat.service.',
    ]),
    '[Unit]',
    'Description=Nova heartbeat dry-run (operator-managed, inert)',
    '',
    '[Timer]',
    systemdTimerLine(schedule),
    'Persistent=false',
    '',
    '[Service]',
    'Type=oneshot',
    `WorkingDirectory=${PROJECT_DIR_PLACEHOLDER}`,
    `ExecStart=${NOVA_BIN_PLACEHOLDER} heartbeat tick --dry-run`,
    '',
  ];
  return lines.join('\n');
}

function systemdTimerLine(schedule: AutomationSchedule): string {
  if (schedule.kind === 'interval' && schedule.everyMinutes) {
    return `OnUnitActiveSec=${schedule.everyMinutes}min`;
  }
  if (schedule.kind === 'daily' && schedule.at) {
    return `OnCalendar=*-*-* ${pad2(schedule.at.h)}:${pad2(schedule.at.m)}:00`;
  }
  throw new HeartbeatScheduleError('Invalid automation schedule.');
}

function renderWindows(schedule: AutomationSchedule): string {
  const taskName = '"NovaHeartbeatDryRun"';
  const taskRun = `"cmd /c cd /d ${PROJECT_DIR_PLACEHOLDER} && ${NOVA_BIN_PLACEHOLDER} heartbeat tick --dry-run"`;
  const lines = [
    ...commentBlock('REM'),
    `schtasks /Create /TN ${taskName} /TR ${taskRun} ${windowsWhen(schedule)} /F`,
    '',
  ];
  return lines.join('\n');
}

function windowsWhen(schedule: AutomationSchedule): string {
  if (schedule.kind === 'daily' && schedule.at) {
    return `/SC DAILY /ST ${pad2(schedule.at.h)}:${pad2(schedule.at.m)}`;
  }
  if (schedule.kind === 'interval' && schedule.everyMinutes) {
    const n = schedule.everyMinutes; // gate-validated upstream: never exceeds 1380 below 1440
    if (n < 1440) {
      return `/SC MINUTE /MO ${n}`; // 1..1380 all valid for schtasks
    }
    return '/SC DAILY /ST 00:00'; // n === 1440 -> daily 00:00
  }
  throw new HeartbeatScheduleError('Invalid automation schedule.');
}

function commentBlock(marker: string, extra: string[] = []): string[] {
  return [...BANNER_LINES, ...extra].map((line) => `${marker} ${line}`);
}

function formatClock(at: { h: number; m: number }): string {
  return `${pad2(at.h)}:${pad2(at.m)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
