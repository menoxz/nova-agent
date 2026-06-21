import type { EvalReport, EvalSchemaVersion } from './types.js';

export const EVAL_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_EVAL_SCHEMA_VERSIONS = [1, EVAL_SCHEMA_VERSION] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function isSupportedEvalSchemaVersion(value: unknown): value is EvalSchemaVersion {
  return value === 1 || value === EVAL_SCHEMA_VERSION;
}

export function validateEvalReport(value: unknown): value is EvalReport {
  if (!isRecord(value)) return false;
  if (!isSupportedEvalSchemaVersion(value.schemaVersion)) return false;
  if (typeof value.evalRunId !== 'string' || !value.evalRunId) return false;
  if (value.mode !== undefined && value.mode !== 'live' && value.mode !== 'mock' && value.mode !== 'replay') return false;
  if (!isRecord(value.summary)) return false;
  if (!Array.isArray(value.results)) return false;
  if (!value.results.every(isRecord)) return false;
  return true;
}

export function normalizeEvalReport(value: unknown): EvalReport | undefined {
  if (!validateEvalReport(value)) return undefined;
  const summary = value.summary;
  return {
    ...value,
    schemaVersion: value.schemaVersion,
    mode: value.mode ?? 'live',
    summary: {
      total: asNumber(summary.total, value.results.length),
      passed: asNumber(summary.passed),
      failed: asNumber(summary.failed),
      errors: asNumber(summary.errors),
      passRate: asNumber(summary.passRate),
      durationMs: asNumber(summary.durationMs),
      averageToolCalls: asNumber(summary.averageToolCalls),
      averageSteps: asNumber(summary.averageSteps),
    },
    results: value.results,
  };
}
