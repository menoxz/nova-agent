import { redactString } from '../policy/redact.js';
import { containsSecretLike } from '../memory/redaction.js';
import type {
  HeartbeatAutomationManifest,
  HeartbeatPlanOccurrence,
  HeartbeatPlanReport,
  HeartbeatPlanTask,
  HeartbeatTaskResult,
  HeartbeatTickReport,
} from './types.js';

const MAX_HEARTBEAT_TEXT_CHARS = 500;

export function safeHeartbeatText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const redacted = redactString(value, MAX_HEARTBEAT_TEXT_CHARS);
  return containsSecretLike(redacted) ? '[REDACTED:secret-like]' : redacted;
}

export function safeHeartbeatPath(path: string): string {
  return safeHeartbeatText(path) ?? '[REDACTED:path]';
}

export function safeHeartbeatTaskResult(task: HeartbeatTaskResult): HeartbeatTaskResult {
  return {
    ...task,
    id: safeHeartbeatText(task.id) ?? '[REDACTED:id]',
    name: safeHeartbeatText(task.name),
    kind: safeHeartbeatText(task.kind) ?? '[REDACTED:kind]',
    action: safeHeartbeatText(task.action),
    reason: safeHeartbeatText(task.reason) ?? '[REDACTED:reason]',
  };
}

export function safeHeartbeatReport(report: HeartbeatTickReport): HeartbeatTickReport {
  return {
    ...report,
    heartbeatId: safeHeartbeatText(report.heartbeatId) ?? '[REDACTED:heartbeatId]',
    tickId: safeHeartbeatText(report.tickId) ?? '[REDACTED:tickId]',
    tasks: report.tasks.map(safeHeartbeatTaskResult),
    safety: {
      ...report.safety,
      secretsIncluded: false,
      notes: report.safety.notes.map((note) => safeHeartbeatText(note) ?? '[REDACTED:note]'),
    },
    paths: {
      json: safeHeartbeatPath(report.paths.json),
      markdown: safeHeartbeatPath(report.paths.markdown),
    },
  };
}

function safeHeartbeatPlanOccurrence(occurrence: HeartbeatPlanOccurrence): HeartbeatPlanOccurrence {
  // `at` and `classification` are structural projection data (ISO timestamp + enum),
  // never secret-bearing, and must stay byte-stable for determinism — only `note` is redacted.
  return {
    at: occurrence.at,
    classification: occurrence.classification,
    note: safeHeartbeatText(occurrence.note),
  };
}

export function safeHeartbeatPlanTask(task: HeartbeatPlanTask): HeartbeatPlanTask {
  return {
    ...task,
    id: safeHeartbeatText(task.id) ?? '[REDACTED:id]',
    name: safeHeartbeatText(task.name),
    kind: safeHeartbeatText(task.kind) ?? '[REDACTED:kind]',
    action: safeHeartbeatText(task.action),
    reason: safeHeartbeatText(task.reason) ?? '[REDACTED:reason]',
    occurrences: task.occurrences.map(safeHeartbeatPlanOccurrence),
  };
}

export function safeHeartbeatPlanReport(report: HeartbeatPlanReport): HeartbeatPlanReport {
  return {
    ...report,
    heartbeatId: safeHeartbeatText(report.heartbeatId) ?? '[REDACTED:heartbeatId]',
    planId: safeHeartbeatText(report.planId) ?? '[REDACTED:planId]',
    tasks: report.tasks.map(safeHeartbeatPlanTask),
    safety: {
      ...report.safety,
      secretsIncluded: false,
      schedulerInstalled: false,
      notes: report.safety.notes.map((note) => safeHeartbeatText(note) ?? '[REDACTED:note]'),
    },
    paths: {
      json: safeHeartbeatPath(report.paths.json),
      markdown: safeHeartbeatPath(report.paths.markdown),
    },
  };
}

/** Redact an automation manifest body line-by-line so no secret or absolute path persists. */
export function safeHeartbeatAutomationBody(body: string): string {
  return body
    .split('\n')
    .map((line) => safeHeartbeatText(line) ?? line)
    .join('\n');
}

export function safeHeartbeatManifest(manifest: HeartbeatAutomationManifest): HeartbeatAutomationManifest {
  return {
    ...manifest,
    installed: false,
    body: safeHeartbeatAutomationBody(manifest.body),
    paths: manifest.paths.file !== undefined ? { file: safeHeartbeatPath(manifest.paths.file) } : {},
  };
}
