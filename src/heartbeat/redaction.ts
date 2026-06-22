import { redactString } from '../policy/redact.js';
import { containsSecretLike } from '../memory/redaction.js';
import type { HeartbeatTaskResult, HeartbeatTickReport } from './types.js';

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
