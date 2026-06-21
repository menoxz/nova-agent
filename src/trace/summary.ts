import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { TraceRun } from './types.js';
import { analyzeTraceRuns, type TraceInsight } from './analyze.js';
import { normalizeTraceRun } from './schema.js';
import { readJsonFileBounded } from '../utils/safe_io.js';

const DEFAULT_SUMMARY_LIMIT = 50;
const MAX_SUMMARY_LIMIT = 500;

export interface TraceSummary {
  directory: string;
  runCount: number;
  successCount: number;
  errorCount: number;
  averageDurationMs: number;
  averageToolCalls: number;
  averageSteps: number;
  averageTokensPerSecond: number;
  averageTotalTokens: number;
  totalEstimatedCost: number;
  costCurrency?: string;
  mostUsedTools: Array<{ toolName: string; count: number }>;
  insights: TraceInsight[];
  recentRuns: Array<{
    runId: string;
    startedAt: string;
    status: string;
    durationMs: number;
    toolCallCount: number;
    stepCount: number;
    totalTokens?: number;
    responseTokensPerSecond?: number;
    totalCost?: number;
    costCurrency?: string;
    outputPath?: string;
  }>;
}

export async function summarizeTraces(options: { traceDir?: string; limit?: number } = {}): Promise<TraceSummary> {
  const directory = resolve(options.traceDir ?? '.nova/traces');
  const requestedLimit = options.limit ?? DEFAULT_SUMMARY_LIMIT;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_SUMMARY_LIMIT)
    : DEFAULT_SUMMARY_LIMIT;
  let files: string[] = [];
  try {
    files = (await readdir(directory))
      .filter((name) => name.endsWith('.json') && name !== 'index.json')
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    files = [];
  }

  const runs: TraceRun[] = [];
  for (const file of files) {
    try {
      const parsed = normalizeTraceRun(await readJsonFileBounded(join(directory, file), 'trace summary JSON'));
      if (parsed) runs.push(parsed);
    } catch {
      // Ignore malformed trace files; summary must remain diagnostic-friendly.
    }
  }

  const toolCounts = new Map<string, number>();
  for (const run of runs) {
    for (const event of run.events) {
      if (event.type === 'tool_call') {
        toolCounts.set(event.toolName, (toolCounts.get(event.toolName) ?? 0) + 1);
      }
    }
  }

  const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
  const average = (values: number[]) => values.length ? Math.round(sum(values) / values.length) : 0;

  const analysis = analyzeTraceRuns(runs);
  const costRuns = runs.filter((run) => typeof run.metrics.totalCost === 'number');
  const costCurrency = costRuns.map((run) => run.metrics.costCurrency).find((value): value is string => Boolean(value));

  return {
    directory,
    runCount: runs.length,
    successCount: runs.filter((run) => run.status === 'success').length,
    errorCount: runs.filter((run) => run.status === 'error').length,
    averageDurationMs: average(runs.map((run) => run.metrics.durationMs)),
    averageToolCalls: average(runs.map((run) => run.metrics.toolCallCount)),
    averageSteps: average(runs.map((run) => run.metrics.stepCount)),
    averageTokensPerSecond: average(runs.map((run) => run.metrics.responseTokensPerSecond ?? 0).filter((value) => value > 0)),
    averageTotalTokens: average(runs.map((run) => run.metrics.totalTokens ?? 0).filter((value) => value > 0)),
    totalEstimatedCost: Number(sum(costRuns.map((run) => run.metrics.totalCost ?? 0)).toFixed(8)),
    costCurrency,
    mostUsedTools: Array.from(toolCounts.entries())
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName))
      .slice(0, 10),
    insights: analysis.insights,
    recentRuns: runs.slice(0, 10).map((run) => ({
      runId: run.runId,
      startedAt: run.startedAt,
      status: run.status,
      durationMs: run.metrics.durationMs,
      toolCallCount: run.metrics.toolCallCount,
      stepCount: run.metrics.stepCount,
      totalTokens: run.metrics.totalTokens,
      responseTokensPerSecond: run.metrics.responseTokensPerSecond,
      totalCost: run.metrics.totalCost,
      costCurrency: run.metrics.costCurrency,
      outputPath: run.outputPath,
    })),
  };
}
