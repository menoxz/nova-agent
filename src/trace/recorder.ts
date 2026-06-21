import { mkdir, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  ErrorEvent,
  FinalAnswerEvent,
  LlmStepEvent,
  RunStartEvent,
  ToolCallEvent,
  ToolExecutionFinishEvent,
  ToolExecutionStartEvent,
  ToolResultEvent,
  TraceConfig,
  TraceEvent,
  TraceFinishResult,
  TraceMetrics,
  TraceRun,
  TraceStatus,
} from './types.js';
import { errorToSafeObject, redactString, redactUnknown } from './redact.js';
import { DEFAULT_TRACE_TOOL_KIND, TRACE_SCHEMA_VERSION } from './schema.js';
import { assertPathUnderDir, projectNovaDir } from '../utils/safe_io.js';

export interface TraceRunContext {
  input: string;
  model: string;
  maxSteps: number;
  toolNames: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function fileSafeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function initialMetrics(): TraceMetrics {
  return {
    durationMs: 0,
    stepCount: 0,
    reasoningStepCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    toolExecutionCount: 0,
    errorCount: 0,
    finalAnswerChars: 0,
  };
}

export class TraceRecorder {
  public readonly runId: string;

  private readonly startedAtMs = Date.now();
  private readonly config: Required<Omit<TraceConfig, 'runIdPrefix'>> & Pick<TraceConfig, 'runIdPrefix'>;
  private readonly run: TraceRun;
  private seq = 0;

  constructor(context: TraceRunContext, config: TraceConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      outputDir: resolveTraceOutputDir(config.outputDir ?? '.nova/traces'),
      includeContent: config.includeContent ?? true,
      contentMaxChars: config.contentMaxChars ?? 2_000,
      writeJsonlIndex: config.writeJsonlIndex ?? true,
      includeErrorStack: config.includeErrorStack ?? false,
      runIdPrefix: config.runIdPrefix,
    };

    const idPrefix = this.config.runIdPrefix ? `${this.config.runIdPrefix}-` : '';
    this.runId = `${idPrefix}${fileSafeTimestamp()}-${randomUUID().slice(0, 8)}`;
    this.run = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: this.runId,
      startedAt: nowIso(),
      status: 'running',
      metrics: initialMetrics(),
      events: [],
    };

    this.recordRunStart(context);
  }

  get snapshot(): TraceRun {
    return structuredClone(this.run);
  }

  recordRunStart(context: TraceRunContext): void {
    const event: RunStartEvent = {
      ...this.eventBase('run_start'),
      input: this.config.includeContent
        ? { preview: redactString(context.input, this.config.contentMaxChars), charCount: context.input.length }
        : undefined,
      config: {
        model: context.model,
        maxSteps: context.maxSteps,
        toolNames: [...context.toolNames].sort(),
        toolCatalog: [...context.toolNames].sort().map((name) => ({ name, kind: DEFAULT_TRACE_TOOL_KIND })),
      },
    };
    this.push(event);
  }

  recordLlmStep(input: { text?: string; toolCallCount: number; toolResultCount: number }): void {
    const event: LlmStepEvent = {
      ...this.eventBase('llm_step'),
      text: input.text ? redactString(input.text, this.config.contentMaxChars) : undefined,
      toolCallCount: input.toolCallCount,
      toolResultCount: input.toolResultCount,
    };
    this.run.metrics.stepCount += 1;
    if (input.text?.trim()) this.run.metrics.reasoningStepCount += 1;
    this.push(event);
  }

  recordToolCall(toolCallId: string, toolName: string, input: unknown): void {
    const event: ToolCallEvent = {
      ...this.eventBase('tool_call'),
      toolCallId,
      toolName,
      toolKind: DEFAULT_TRACE_TOOL_KIND,
      input: redactUnknown(input, this.redactionOptions()),
    };
    this.run.metrics.toolCallCount += 1;
    this.push(event);
  }

  recordToolResult(toolCallId: string | undefined, toolName: string, output: unknown): void {
    const event: ToolResultEvent = {
      ...this.eventBase('tool_result'),
      toolCallId,
      toolName,
      toolKind: DEFAULT_TRACE_TOOL_KIND,
      output: redactUnknown(output, this.redactionOptions()),
    };
    this.run.metrics.toolResultCount += 1;
    this.push(event);
  }

  recordToolExecutionStart(toolName: string, input: unknown, toolCallId?: string): void {
    const event: ToolExecutionStartEvent = {
      ...this.eventBase('tool_execution_start'),
      toolCallId,
      toolName,
      toolKind: DEFAULT_TRACE_TOOL_KIND,
      input: redactUnknown(input, this.redactionOptions()),
    };
    this.push(event);
  }

  recordToolExecutionFinish(input: { toolName: string; toolCallId?: string; durationMs: number; ok: boolean; output?: unknown; error?: unknown }): void {
    const safeError = input.error ? errorToSafeObject(input.error).message : undefined;
    const event: ToolExecutionFinishEvent = {
      ...this.eventBase('tool_execution_finish'),
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolKind: DEFAULT_TRACE_TOOL_KIND,
      durationMs: input.durationMs,
      ok: input.ok,
      output: input.ok ? redactUnknown(input.output, this.redactionOptions()) : undefined,
      error: safeError,
    };
    this.run.metrics.toolExecutionCount += 1;
    if (!input.ok) this.run.metrics.errorCount += 1;
    this.push(event);
  }

  recordFinalAnswer(text: string): void {
    const event: FinalAnswerEvent = {
      ...this.eventBase('final_answer'),
      text: this.config.includeContent ? redactString(text, this.config.contentMaxChars) : undefined,
      charCount: text.length,
    };
    this.run.metrics.finalAnswerChars = text.length;
    this.push(event);
  }

  recordError(err: unknown): void {
    const safe = errorToSafeObject(err);
    const event: ErrorEvent = {
      ...this.eventBase('error'),
      message: safe.message,
      name: safe.name,
      stack: this.config.includeErrorStack ? safe.stack : undefined,
    };
    this.run.metrics.errorCount += 1;
    this.push(event);
  }

  async finish(status: Exclude<TraceStatus, 'running'>): Promise<TraceFinishResult> {
    this.run.status = status;
    this.run.endedAt = nowIso();
    this.run.metrics.durationMs = Date.now() - this.startedAtMs;

    const outputDir = this.config.outputDir;
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${this.runId}.json`);
    this.run.outputPath = outputPath;

    await writeJsonAtomic(outputPath, this.run);
    if (this.config.writeJsonlIndex) {
      const indexPath = join(outputDir, 'index.jsonl');
      const compact = {
        runId: this.run.runId,
        startedAt: this.run.startedAt,
        endedAt: this.run.endedAt,
        status: this.run.status,
        outputPath,
        metrics: this.run.metrics,
      };
      await appendFile(indexPath, `${JSON.stringify(compact)}\n`, 'utf-8');
    }

    return { run: this.snapshot, outputPath };
  }

  private eventBase<T extends TraceEvent['type']>(type: T): { id: string; type: T; timestamp: string; elapsedMs: number } {
    this.seq += 1;
    return {
      id: `${this.runId}:${this.seq.toString().padStart(4, '0')}`,
      type,
      timestamp: nowIso(),
      elapsedMs: Date.now() - this.startedAtMs,
    };
  }

  private push(event: TraceEvent): void {
    this.run.events.push(event);
  }

  private redactionOptions() {
    return {
      includeContent: this.config.includeContent,
      maxChars: this.config.contentMaxChars,
    };
  }
}

export function createTraceRecorder(context: TraceRunContext, config?: TraceConfig): TraceRecorder | undefined {
  if (!config?.enabled) return undefined;
  return new TraceRecorder(context, config);
}

function resolveTraceOutputDir(outputDir: string): string {
  const resolved = resolve(outputDir);
  if (process.env.NOVA_TRACE_ALLOW_OUTSIDE === '1') return resolved;
  return assertPathUnderDir(
    resolved,
    projectNovaDir(),
    'Trace output directory (set NOVA_TRACE_ALLOW_OUTSIDE=1 to override)',
  );
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tmp, path);
}
