import chalk from 'chalk';

import { redactString } from '../policy/redact.js';
import type { ResponseTokenMetrics } from '../tokens/types.js';
import type { RuntimeStreamingEvent } from '../streaming/types.js';

export interface TuiReplaySummary {
  status: 'idle' | 'running' | 'finished' | 'error';
  model?: string;
  sessionId?: string;
  runId?: string;
  eventCount: number;
  tokenCount: number;
  toolCallCount: number;
  toolResultCount: number;
  reasoningChars: number;
  answerChars: number;
  error?: string;
  metrics?: ResponseTokenMetrics;
  startedAt?: string;
  finishedAt?: string;
}

export type TuiReplayMode = 'compact' | 'normal' | 'verbose';

export interface TuiReplayRenderOptions {
  title?: string;
  mode?: TuiReplayMode;
}

export class TuiReplayRenderer {
  render(events: RuntimeStreamingEvent[], options: TuiReplayRenderOptions = {}): string {
    const mode = options.mode ?? 'normal';
    const summary = summarizeTuiReplay(events);
    const tools = collectTools(events);
    const reasoning = collectReasoning(events);
    const answer = collectAnswer(events);
    const timeline = collectTimeline(events, mode);
    const lines: string[] = [];
    lines.push(chalk.cyanBright.bold(`╭─ ${options.title ?? 'Nova TUI replay'} ─────────────────────────`));
    lines.push(`│ status ${statusText(summary.status)}${summary.model ? chalk.gray(` · model ${summary.model}`) : ''}`);
    lines.push(`│ events ${summary.eventCount} · tokens ${summary.tokenCount} · tools ${summary.toolCallCount}/${summary.toolResultCount}`);
    if (summary.sessionId || summary.runId) lines.push(`│ session ${summary.sessionId ?? 'none'} · run ${summary.runId ?? 'none'}`);
    if (summary.startedAt || summary.finishedAt) lines.push(`│ time ${summary.startedAt ?? '?'} → ${summary.finishedAt ?? '?'}`);
    if (summary.metrics) lines.push(`│ metrics ${formatMetrics(summary.metrics)}`);
    if (summary.error) lines.push(chalk.red(`│ error ${redactString(summary.error, 500)}`));
    lines.push(chalk.cyanBright('╰────────────────────────────────────────'));
    if (mode === 'compact') {
      lines.push(renderAnswerPanel(answer, summary.error, 600));
      return lines.join('\n');
    }
    lines.push('');
    lines.push(renderTimelinePanel(timeline));
    lines.push('');
    lines.push(renderToolsPanel(tools));
    lines.push('');
    lines.push(renderReasoningPanel(reasoning, mode));
    lines.push('');
    lines.push(renderAnswerPanel(answer, summary.error, mode === 'verbose' ? 4_000 : 2_000));
    return lines.join('\n');
  }
}

export function summarizeTuiReplay(events: RuntimeStreamingEvent[]): TuiReplaySummary {
  const start = events.find((event) => event.type === 'start');
  const finish = [...events].reverse().find((event): event is Extract<RuntimeStreamingEvent, { type: 'finish' }> => event.type === 'finish');
  const error = [...events].reverse().find((event): event is Extract<RuntimeStreamingEvent, { type: 'error' }> => event.type === 'error');
  const metrics = finish?.metrics ?? [...events].reverse().find((event): event is Extract<RuntimeStreamingEvent, { type: 'metrics' }> => event.type === 'metrics')?.metrics;
  const tokenCount = finish?.metrics.completionTokens ?? events.filter((event) => event.type === 'token').at(-1)?.completionTokens ?? 0;
  const reasoning = collectReasoning(events);
  const answer = collectAnswer(events);
  return {
    status: error ? 'error' : finish ? 'finished' : start ? 'running' : 'idle',
    model: start?.type === 'start' ? start.model : undefined,
    sessionId: finish?.sessionId ?? error?.sessionId ?? start?.sessionId ?? events.find((event) => event.sessionId)?.sessionId,
    runId: finish?.runId ?? error?.runId ?? start?.runId ?? events.find((event) => event.runId)?.runId,
    eventCount: events.length,
    tokenCount,
    toolCallCount: events.filter((event) => event.type === 'tool_call').length,
    toolResultCount: events.filter((event) => event.type === 'tool_result').length,
    reasoningChars: reasoning.length,
    answerChars: answer.length,
    error: error?.message,
    metrics,
    startedAt: events[0]?.timestamp,
    finishedAt: finish?.timestamp ?? error?.timestamp ?? events.at(-1)?.timestamp,
  };
}

function collectTools(events: RuntimeStreamingEvent[]): string[] {
  return events.filter((event) => event.type === 'tool_call' || event.type === 'tool_result').map((event) => {
    if (event.type === 'tool_call') return `→ ${event.toolName}${event.inputPreview ? ` ${redactString(event.inputPreview, 140)}` : ''}`;
    const icon = event.ok ? '✓' : '✖';
    return `${icon} ${event.toolName} ${redactString(event.outputPreview, 160)}`;
  });
}

function collectTimeline(events: RuntimeStreamingEvent[], mode: TuiReplayMode): string[] {
  const interesting = events.filter((event) => ['start', 'status', 'tool_call', 'tool_result', 'metrics', 'error', 'finish'].includes(event.type));
  const sliced = mode === 'verbose' ? interesting : interesting.slice(0, 40);
  const rows = sliced.map((event) => timelineLine(event, mode));
  if (sliced.length < interesting.length) rows.push(chalk.gray(`… ${interesting.length - sliced.length} more timeline events`));
  return rows;
}

function timelineLine(event: RuntimeStreamingEvent, mode: TuiReplayMode): string {
  const prefix = mode === 'verbose' ? `${event.sequence.toString().padStart(4, '0')} ${event.timestamp} ` : `${event.sequence.toString().padStart(4, '0')} `;
  switch (event.type) {
    case 'start': return `${prefix}${chalk.green('start')} model=${event.model}${event.estimatedPromptTokens ? ` prompt~${event.estimatedPromptTokens}` : ''}`;
    case 'status': return `${prefix}${chalk.gray('status')} ${redactString(event.message, 180)}`;
    case 'tool_call': return `${prefix}${chalk.blue('tool →')} ${event.toolName}${mode === 'verbose' && event.inputPreview ? ` ${redactString(event.inputPreview, 220)}` : ''}`;
    case 'tool_result': return `${prefix}${event.ok ? chalk.green('tool ✓') : chalk.red('tool ✖')} ${event.toolName}${mode === 'verbose' ? ` ${redactString(event.outputPreview, 220)}` : ''}`;
    case 'metrics': return `${prefix}${chalk.gray('metrics')} ${formatMetrics(event.metrics)}`;
    case 'error': return `${prefix}${chalk.red('error')} ${redactString(event.message, 240)}`;
    case 'finish': return `${prefix}${chalk.green('finish')} ${event.elapsedMs}ms · tools=${event.toolCallCount} · ${formatMetrics(event.metrics)}`;
    default: return `${prefix}${event.type}`;
  }
}

function collectReasoning(events: RuntimeStreamingEvent[]): string {
  return events.flatMap((event) => {
    if (event.type === 'reasoning_end' || event.type === 'reasoning_delta') return [event.text];
    return [];
  }).join('');
}

function collectAnswer(events: RuntimeStreamingEvent[]): string {
  const finish = [...events].reverse().find((event): event is Extract<RuntimeStreamingEvent, { type: 'finish' }> => event.type === 'finish');
  if (finish?.text) return finish.text;
  return events.filter((event): event is Extract<RuntimeStreamingEvent, { type: 'token' }> => event.type === 'token').map((event) => event.text).join('');
}

function renderToolsPanel(tools: string[]): string {
  if (!tools.length) return `${chalk.blue.bold('Tools')}\n  ${chalk.gray('none')}`;
  return [chalk.blue.bold('Tools'), ...tools.slice(0, 25).map((tool) => `  ${tool}`), ...(tools.length > 25 ? [`  ${chalk.gray(`… ${tools.length - 25} more`)}`] : [])].join('\n');
}

function renderTimelinePanel(timeline: string[]): string {
  if (!timeline.length) return `${chalk.cyan.bold('Timeline')}\n  ${chalk.gray('none')}`;
  return [chalk.cyan.bold('Timeline'), ...timeline.map((line) => `  ${line}`)].join('\n');
}

function renderReasoningPanel(reasoning: string, mode: TuiReplayMode): string {
  const safe = redactString(reasoning.trim(), mode === 'verbose' ? 1_800 : 900);
  if (!safe) return `${chalk.yellow.bold('Reasoning')}\n  ${chalk.gray('none')}`;
  return [chalk.yellow.bold(`Reasoning collapsed (${safe.length} chars)`), indent(`${safe}${reasoning.length > safe.length ? '…' : ''}`)].join('\n');
}

function renderAnswerPanel(answer: string, error?: string, maxChars = 2_000): string {
  if (error) return `${chalk.red.bold('Error')}\n${indent(redactString(error, 1_000))}`;
  const safe = redactString(answer.trim(), maxChars);
  if (!safe) return `${chalk.magentaBright.bold('Final answer')}\n  ${chalk.gray('none')}`;
  return `${chalk.magentaBright.bold('Final answer')}\n${indent(safe)}`;
}

function indent(text: string): string {
  return text.split(/\r?\n/).map((line) => `  ${line}`).join('\n');
}

function statusText(status: TuiReplaySummary['status']): string {
  if (status === 'finished') return chalk.green(status);
  if (status === 'error') return chalk.red(status);
  if (status === 'running') return chalk.yellow(status);
  return chalk.gray(status);
}

function formatMetrics(metrics: ResponseTokenMetrics): string {
  const usage = `prompt=${metrics.promptTokens ?? '?'} completion=${metrics.completionTokens ?? '?'} total=${metrics.totalTokens ?? '?'}`;
  const speed = `${metrics.responseTokensPerSecond} tok/s`;
  const cost = metrics.cost ? ` · ~${metrics.cost.totalCost.toFixed(8)} ${metrics.cost.currency}` : '';
  return `${usage} · ${speed}${cost}`;
}
