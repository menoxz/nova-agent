import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { redactString, redactUnknown } from '../policy/redact.js';
import { assertPathUnderDir, projectNovaDir } from '../utils/safe_io.js';
import type { RuntimeStreamingEvent, StreamingConfig, StreamingEventLogConfig } from './types.js';
import { resolveStreamingConfig } from './types.js';

export interface StreamingEventLogRecord {
  schemaVersion: 1;
  event: RuntimeStreamingEvent;
  persistedAt: string;
  safety: {
    redacted: true;
    rawPromptsIncluded: false;
    rawToolInputsIncluded: false;
    secretsIncluded: false;
  };
}

export interface StreamingEventLogSummary {
  logId: string;
  path: string;
  sessionId?: string;
  runId?: string;
  sizeBytes: number;
  updatedAt: string;
}

export class StreamingEventLogStore {
  private readonly config: Required<StreamingEventLogConfig>;
  private readonly root: string;
  private readonly counters = new Map<string, number>();

  constructor(config?: StreamingConfig | StreamingEventLogConfig, projectRoot = process.cwd()) {
    const eventLog = normalizeEventLogConfig('eventLog' in (config ?? {}) ? (config as StreamingConfig).eventLog : config as StreamingEventLogConfig | undefined);
    this.config = eventLog;
    this.root = resolveStreamingLogRoot(projectRoot, this.config.root);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async append(event: RuntimeStreamingEvent): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    const logId = eventLogId(event);
    const count = (this.counters.get(logId) ?? 0) + 1;
    this.counters.set(logId, count);
    if (count > this.config.maxEvents) return undefined;
    const path = this.pathForLogId(logId);
    await mkdir(dirname(path), { recursive: true });
    const record: StreamingEventLogRecord = {
      schemaVersion: 1,
      event: sanitizeRuntimeEvent(event, this.config),
      persistedAt: new Date().toISOString(),
      safety: { redacted: true, rawPromptsIncluded: false, rawToolInputsIncluded: false, secretsIncluded: false },
    };
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf-8');
    return path;
  }

  async read(logId: string): Promise<RuntimeStreamingEvent[]> {
    const path = this.pathForLogId(logId);
    const text = await readFile(path, 'utf-8');
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as StreamingEventLogRecord).map((record) => record.event);
  }

  async list(): Promise<StreamingEventLogSummary[]> {
    await mkdir(this.root, { recursive: true });
    const summaries: StreamingEventLogSummary[] = [];
    await collectJsonl(this.root, summaries, this.root);
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  pathForLogId(logId: string): string {
    const safe = safeLogId(logId);
    const [sessionId, runId] = safe.includes('__') ? safe.split('__', 2) : ['standalone', safe];
    return assertPathUnderDir(join(this.root, sessionId, `${runId}.jsonl`), this.root, 'Streaming event log path');
  }
}

function normalizeEventLogConfig(config?: StreamingEventLogConfig): Required<StreamingEventLogConfig> {
  const defaults = resolveStreamingConfig().eventLog;
  return {
    enabled: config?.enabled ?? defaults.enabled ?? false,
    root: config?.root ?? defaults.root ?? '.nova/streaming/events',
    includeText: config?.includeText ?? defaults.includeText ?? true,
    maxTextChars: config?.maxTextChars ?? defaults.maxTextChars ?? 2_000,
    maxEvents: config?.maxEvents ?? defaults.maxEvents ?? 20_000,
  };
}

export function eventLogId(event: RuntimeStreamingEvent): string {
  if (event.sessionId && event.runId) return `${event.sessionId}__${event.runId}`;
  return event.runId ?? event.sessionId ?? 'standalone';
}

export function sanitizeRuntimeEvent(event: RuntimeStreamingEvent, config: Required<StreamingEventLogConfig>): RuntimeStreamingEvent {
  const safe = redactUnknown(event, { includeContent: true, maxChars: config.maxTextChars, maxDepth: 6, maxArrayItems: 50 }) as RuntimeStreamingEvent;
  preserveSafeNumericMetrics(event, safe);
  if (!config.includeText) {
    if ('text' in safe) safe.text = textPlaceholder(event);
    if (safe.type === 'tool_call') safe.inputPreview = safe.inputPreview ? '<content omitted>' : undefined;
    if (safe.type === 'tool_result') safe.outputPreview = '<content omitted>';
    if (safe.type === 'status') safe.message = redactString(safe.message, 300);
  }
  if ('text' in safe && typeof safe.text === 'string') safe.text = redactString(safe.text, config.maxTextChars);
  if (safe.type === 'tool_call' && safe.inputPreview) safe.inputPreview = redactString(safe.inputPreview, config.maxTextChars);
  if (safe.type === 'tool_result') safe.outputPreview = redactString(safe.outputPreview, config.maxTextChars);
  if (safe.type === 'error') safe.message = redactString(safe.message, 1_000);
  return safe;
}

function preserveSafeNumericMetrics(original: RuntimeStreamingEvent, safe: RuntimeStreamingEvent): void {
  if (original.type === 'start' && safe.type === 'start') safe.estimatedPromptTokens = original.estimatedPromptTokens;
  if (original.type === 'token' && safe.type === 'token') safe.completionTokens = original.completionTokens;
  if (original.type === 'metrics' && safe.type === 'metrics') safe.metrics = original.metrics;
  if (original.type === 'finish' && safe.type === 'finish') safe.metrics = original.metrics;
}

function textPlaceholder(event: RuntimeStreamingEvent): string {
  if (event.type === 'token') return `<text omitted: ${event.text.length} chars>`;
  if (event.type === 'reasoning_delta' || event.type === 'reasoning_end' || event.type === 'finish') return '<text omitted>';
  return '<content omitted>';
}

function resolveStreamingLogRoot(projectRoot: string, override?: string): string {
  const novaDir = projectNovaDir(projectRoot);
  const root = resolve(projectRoot, override ?? '.nova/streaming/events');
  return assertPathUnderDir(root, novaDir, 'Streaming event log root');
}

function safeLogId(value: string): string {
  const name = basename(value).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name || name === '.' || name === '..') throw new Error('Unsafe streaming log id');
  return name;
}

async function collectJsonl(dir: string, out: StreamingEventLogSummary[], root: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await collectJsonl(path, out, root); continue; }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const stats = await stat(path);
    const rel = path.slice(root.length + 1).replace(/\\/g, '/');
    const [sessionId, file] = rel.split('/');
    const runId = file?.replace(/\.jsonl$/, '');
    out.push({ logId: sessionId === 'standalone' ? runId : `${sessionId}__${runId}`, path, sessionId: sessionId === 'standalone' ? undefined : sessionId, runId, sizeBytes: stats.size, updatedAt: stats.mtime.toISOString() });
  }
}
