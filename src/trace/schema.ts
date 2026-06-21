import type { TraceMetrics, TraceRun, TraceSchemaVersion, TraceStatus, TraceToolKind } from './types.js';

export const TRACE_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_TRACE_SCHEMA_VERSIONS = [1, TRACE_SCHEMA_VERSION] as const;
export const DEFAULT_TRACE_TOOL_KIND: TraceToolKind = 'builtin';

const TRACE_STATUSES = new Set<TraceStatus>(['running', 'success', 'error']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeMetrics(value: unknown): TraceMetrics {
  const metrics = isRecord(value) ? value : {};
  return {
    durationMs: asNumber(metrics.durationMs),
    stepCount: asNumber(metrics.stepCount),
    reasoningStepCount: asNumber(metrics.reasoningStepCount),
    toolCallCount: asNumber(metrics.toolCallCount),
    toolResultCount: asNumber(metrics.toolResultCount),
    toolExecutionCount: asNumber(metrics.toolExecutionCount),
    errorCount: asNumber(metrics.errorCount),
    finalAnswerChars: asNumber(metrics.finalAnswerChars),
  };
}

export function isSupportedTraceSchemaVersion(value: unknown): value is TraceSchemaVersion {
  return value === 1 || value === TRACE_SCHEMA_VERSION;
}

export function validateTraceRun(value: unknown): value is TraceRun {
  if (!isRecord(value)) return false;
  if (!isSupportedTraceSchemaVersion(value.schemaVersion)) return false;
  if (typeof value.runId !== 'string' || !value.runId) return false;
  if (typeof value.startedAt !== 'string' || !value.startedAt) return false;
  if (!TRACE_STATUSES.has(value.status as TraceStatus)) return false;
  if (!isRecord(value.metrics)) return false;
  if (!Array.isArray(value.events)) return false;
  if (!value.events.every(isRecord)) return false;
  return true;
}

export function normalizeTraceRun(value: unknown): TraceRun | undefined {
  if (!validateTraceRun(value)) return undefined;
  return {
    ...value,
    schemaVersion: value.schemaVersion,
    metrics: normalizeMetrics(value.metrics),
    events: value.events,
  };
}
