import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { NovaAgent } from '../agent.js';
import type { AgentConfig, StepDisplay } from '../types.js';
import type { AgentRunSummary, RuntimeStreamingEvent } from '../streaming/types.js';
import { StreamingEventLogStore } from '../streaming/log.js';
import { StreamingCliRenderer } from '../streaming/cli.js';
import { CurrentSessionStore } from '../session/index.js';
import { redactString } from '../policy/redact.js';
import type { ToolRegistry } from '../tools/registry.js';
import { assertPathUnderDir } from '../utils/safe_io.js';
import { loadBatchItems } from './parser.js';
import type { BatchItem, BatchItemReport, BatchReport, BatchReportStatus, BatchRunOptions } from './types.js';

const PREVIEW_CHARS = 500;

export async function runBatch(config: AgentConfig, tools: ToolRegistry, filePath: string, options: BatchRunOptions = {}): Promise<BatchReport> {
  const loaded = await loadBatchItems(filePath);
  const plan = planBatchItems(loaded.items, options);
  const batchId = `batch_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const reportPath = resolveBatchReportPath(options.reportPath ?? `.nova/batch/${batchId}.json`);
  const items: BatchItemReport[] = [...plan.skippedBefore];
  const runConfig = batchConfig(config, options);
  const requestedStreaming = options.streaming ?? runConfig.streaming?.enabled === true;
  const internalStreaming = requestedStreaming || options.eventLog === true;

  for (const [index, item] of plan.selected.entries()) {
    await Promise.resolve(options.onItemStart?.({ item, index: index + 1, total: plan.selected.length })).catch(() => undefined);
    const result = await runBatchItem(runConfig, tools, item, { ...options, requestedStreaming, internalStreaming });
    items.push(result);
    await Promise.resolve(options.onItemFinish?.({ item, report: result, index: index + 1, total: plan.selected.length })).catch(() => undefined);
    if (result.status === 'error' && !options.continueOnError) {
      for (const skipped of plan.selected.slice(index + 1)) items.push(skippedItemReport(skipped, 'Skipped because a previous batch item failed and --continue-on-error was not set.'));
      break;
    }
  }
  items.push(...plan.skippedAfter);

  const finishedAtMs = Date.now();
  const counts = countItems(items);
  const report: BatchReport = {
    schemaVersion: 1,
    batchId,
    status: reportStatus(items),
    inputFile: loaded.path,
    reportPath,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    options: {
      streaming: requestedStreaming,
      eventLog: options.eventLog === true,
      continueOnError: options.continueOnError === true,
      dryRun: false,
      limit: options.limit,
      onlyIds: options.onlyIds,
      fromId: options.fromId,
    },
    counts,
    items,
  };
  await writeBatchReport(reportPath, report);
  return report;
}

export async function dryRunBatch(filePath: string, options: BatchRunOptions = {}): Promise<BatchReport> {
  const loaded = await loadBatchItems(filePath);
  const plan = planBatchItems(loaded.items, options);
  const batchId = `batch_dry_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const startedAtMs = Date.now();
  const reportPath = resolveBatchReportPath(options.reportPath ?? `.nova/batch/${batchId}.json`);
  const selectedReports = plan.selected.map((item) => skippedItemReport(item, 'Dry run: item validated but not executed.'));
  const items = [...plan.skippedBefore, ...selectedReports, ...plan.skippedAfter];
  const finishedAtMs = Date.now();
  const counts = countItems(items);
  const report: BatchReport = {
    schemaVersion: 1,
    batchId,
    status: 'completed',
    inputFile: loaded.path,
    reportPath,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    options: {
      streaming: false,
      eventLog: false,
      continueOnError: options.continueOnError === true,
      dryRun: true,
      limit: options.limit,
      onlyIds: options.onlyIds,
      fromId: options.fromId,
    },
    counts,
    items,
  };
  await writeBatchReport(reportPath, report);
  return report;
}

export interface BatchSelectionPlan {
  selected: BatchItem[];
  skippedBefore: BatchItemReport[];
  skippedAfter: BatchItemReport[];
}

export function planBatchItems(items: BatchItem[], options: Pick<BatchRunOptions, 'limit' | 'onlyIds' | 'fromId'> = {}): BatchSelectionPlan {
  const only = options.onlyIds?.length ? new Set(options.onlyIds) : undefined;
  if (only) {
    const ids = new Set(items.map((item) => item.id));
    const missing = [...only].filter((id) => !ids.has(id));
    if (missing.length) throw new Error(`Unknown --only id(s): ${missing.join(', ')}. Available ids: ${items.map((item) => item.id).join(', ')}`);
  }
  let fromSeen = options.fromId ? false : true;
  if (options.fromId && !items.some((item) => item.id === options.fromId)) throw new Error(`Unknown --from id: ${options.fromId}. Available ids: ${items.map((item) => item.id).join(', ')}`);
  const selected: BatchItem[] = [];
  const skippedBefore: BatchItemReport[] = [];
  const skippedAfter: BatchItemReport[] = [];
  for (const item of items) {
    if (!fromSeen) {
      if (item.id === options.fromId) fromSeen = true;
      else { skippedBefore.push(skippedItemReport(item, `Skipped by --from ${options.fromId}.`)); continue; }
    }
    if (only && !only.has(item.id)) {
      skippedBefore.push(skippedItemReport(item, 'Skipped by --only filter.'));
      continue;
    }
    if (typeof options.limit === 'number' && selected.length >= options.limit) {
      skippedAfter.push(skippedItemReport(item, `Skipped by --limit ${options.limit}.`));
      continue;
    }
    selected.push(item);
  }
  if (!selected.length) throw new Error('Batch selection matched no items. Adjust --only, --from or --limit.');
  return { selected, skippedBefore, skippedAfter };
}

function batchConfig(config: AgentConfig, options: BatchRunOptions): AgentConfig {
  return {
    ...config,
    session: config.session ? { ...config.session, enabled: config.session.enabled, title: config.session.title ?? 'Nova batch run', tags: [...(config.session.tags ?? []), 'batch'] } : config.session,
    streaming: {
      ...config.streaming,
      enabled: (options.streaming ?? config.streaming?.enabled) || options.eventLog === true,
      eventLog: {
        ...config.streaming?.eventLog,
        enabled: options.eventLog === true ? true : config.streaming?.eventLog?.enabled,
      },
    },
  };
}

async function runBatchItem(config: AgentConfig, tools: ToolRegistry, item: BatchItem, options: BatchRunOptions & { requestedStreaming: boolean; internalStreaming: boolean }): Promise<BatchItemReport> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let finishEvent: Extract<RuntimeStreamingEvent, { type: 'finish' }> | undefined;
  let lastEvent: RuntimeStreamingEvent | undefined;
  let summary: AgentRunSummary | undefined;
  const events: RuntimeStreamingEvent[] = [];
  try {
    const agent = new NovaAgent(config, tools);
    const renderer = options.requestedStreaming ? new StreamingCliRenderer(config.streaming) : undefined;
    const steps = await agent.run(item.prompt, {
      streaming: options.internalStreaming,
      onEvent: (event) => {
        events.push(event);
        lastEvent = event;
        if (event.type === 'finish') finishEvent = event;
        renderer?.handle(event);
      },
      onFinish: (value) => {
        summary = value;
      },
    });
    const finalAnswer = finalAnswerFromSteps(steps);
    const error = summary?.status === 'error' ? summary.error ?? summary.text : finalAnswer && /✖ Error:|\bError:/.test(finalAnswer) ? redactString(stripAnsi(finalAnswer), PREVIEW_CHARS) : undefined;
    const finishedAtMs = Date.now();
    const current = await currentRun(config).catch(() => undefined);
    const log = eventLogReference(config, finishEvent ?? lastEvent);
    return {
      id: item.id,
      status: error ? 'error' : 'success',
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      promptPreview: safePreview(item.prompt),
      answerPreview: finalAnswer ? safePreview(finalAnswer) : undefined,
      error,
      metrics: summary?.metrics ?? finishEvent?.metrics,
      run: summaryRun(summary) ?? eventRun(finishEvent ?? lastEvent) ?? current,
      eventLog: summaryEventLog(summary) ?? log,
    };
  } catch (err) {
    const finishedAtMs = Date.now();
    return {
      id: item.id,
      status: 'error',
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      promptPreview: safePreview(item.prompt),
      error: redactString(err instanceof Error ? err.message : String(err), PREVIEW_CHARS),
      run: eventRun(lastEvent),
      eventLog: eventLogReference(config, lastEvent),
    };
  }
}

function summaryRun(summary: AgentRunSummary | undefined): { sessionId?: string; runId?: string } | undefined {
  if (!summary?.sessionId && !summary?.runId) return undefined;
  return { sessionId: summary.sessionId, runId: summary.runId };
}

function summaryEventLog(summary: AgentRunSummary | undefined): { logId?: string; path?: string } | undefined {
  if (!summary?.streamingEventLogPath || (!summary.sessionId && !summary.runId)) return undefined;
  return { logId: summary.sessionId && summary.runId ? `${summary.sessionId}__${summary.runId}` : summary.runId ?? summary.sessionId, path: summary.streamingEventLogPath };
}

function finalAnswerFromSteps(steps: StepDisplay[]): string | undefined {
  return [...steps].reverse().find((step) => step.type === 'answer')?.content;
}

function safePreview(value: string): string {
  return redactString(stripAnsi(value), PREVIEW_CHARS);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

async function currentRun(config: AgentConfig): Promise<{ sessionId?: string; runId?: string } | undefined> {
  if (!config.session?.enabled) return undefined;
  const current = await new CurrentSessionStore(config.session).get();
  return current ? { sessionId: current.sessionId, runId: current.runId } : undefined;
}

function eventRun(event: RuntimeStreamingEvent | undefined): { sessionId?: string; runId?: string } | undefined {
  if (!event?.sessionId && !event?.runId) return undefined;
  return { sessionId: event.sessionId, runId: event.runId };
}

function eventLogReference(config: AgentConfig, event: RuntimeStreamingEvent | undefined): { logId?: string; path?: string } | undefined {
  if (!event || config.streaming?.eventLog?.enabled !== true) return undefined;
  const logId = event.sessionId && event.runId ? `${event.sessionId}__${event.runId}` : event.runId ?? event.sessionId;
  if (!logId) return undefined;
  const store = new StreamingEventLogStore(config.streaming);
  return { logId, path: store.pathForLogId(logId) };
}

function skippedItemReport(item: BatchItem, reason: string): BatchItemReport {
  const now = new Date().toISOString();
  return {
    id: item.id,
    status: 'skipped',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    promptPreview: safePreview(item.prompt),
    skipReason: reason,
  };
}

function countItems(items: BatchItemReport[]): BatchReport['counts'] {
  return {
    total: items.length,
    success: items.filter((item) => item.status === 'success').length,
    error: items.filter((item) => item.status === 'error').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
  };
}

function reportStatus(items: BatchItemReport[]): BatchReportStatus {
  const counts = countItems(items);
  if (counts.error === 0 && counts.skipped === 0) return 'completed';
  if (counts.error === 0) return 'completed';
  if (counts.success > 0) return 'partial';
  return 'failed';
}

async function writeBatchReport(path: string, report: BatchReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}

function resolveBatchReportPath(path: string): string {
  const resolved = resolve(path);
  return assertPathUnderDir(resolved, process.cwd(), 'Batch report path');
}
