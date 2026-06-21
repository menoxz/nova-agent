import chalk from 'chalk';
import { estimateTokens, tokensPerSecond } from '../tokens/index.js';
import { redactString } from '../policy/redact.js';
import type { StreamingConfig, StreamingEvent } from './types.js';
import { resolveStreamingConfig } from './types.js';
export { estimatedLiveCost, safePreview } from './utils.js';

export class StreamingCliRenderer {
  private readonly config: Required<StreamingConfig>;
  private startedAt = Date.now();
  private timer?: NodeJS.Timeout;
  private completionTokens = 0;
  private toolCalls = 0;
  private reasoningBuffer = '';
  private answerStarted = false;
  private lastMetricsLine = '';

  constructor(config?: StreamingConfig) {
    this.config = resolveStreamingConfig(config);
  }

  handle = (event: StreamingEvent): void => {
    switch (event.type) {
      case 'start': return this.start(event);
      case 'status': return this.status(event.message);
      case 'token': return this.token(event.text, event.completionTokens, event.elapsedMs);
      case 'reasoning_start': return this.reasoningStart();
      case 'reasoning_delta': return this.reasoningDelta(event.text);
      case 'reasoning_end': return this.reasoningEnd(event.text);
      case 'tool_call': return this.toolCall(event.toolName, event.inputPreview);
      case 'tool_result': return this.toolResult(event.toolName, event.outputPreview, event.ok);
      case 'metrics': return this.metrics(event.metrics.responseDurationMs, event.metrics.completionTokens ?? this.completionTokens, event.metrics.cost?.totalCost, event.metrics.cost?.currency);
      case 'finish': return this.finish(event);
      case 'error': return this.error(event.message, event.elapsedMs);
    }
  };

  private start(event: Extract<StreamingEvent, { type: 'start' }>): void {
    this.startedAt = Date.now();
    this.completionTokens = 0;
    this.toolCalls = 0;
    console.log('');
    console.log(chalk.cyanBright.bold('╭─ Nova streaming run'));
    console.log(chalk.gray(`│ model ${event.model}`));
    if (event.sessionId || event.runId) console.log(chalk.gray(`│ session ${event.sessionId ?? 'none'} · run ${event.runId ?? 'none'}`));
    if (typeof event.estimatedPromptTokens === 'number') console.log(chalk.gray(`│ prompt ~${event.estimatedPromptTokens} tokens`));
    console.log(chalk.cyanBright('╰────────────────────────────────────────'));
    if (this.config.showMetrics) this.timer = setInterval(() => this.renderLiveMetrics(), this.config.refreshMs);
  }

  private status(message: string): void {
    console.log(chalk.gray(`\n◇ ${redactString(message, 200)}`));
  }

  private token(text: string, completionTokens: number, elapsedMs: number): void {
    this.completionTokens = completionTokens;
    if (!this.config.showTokens) return;
    if (!this.answerStarted) {
      this.answerStarted = true;
      process.stdout.write(chalk.magentaBright('\n✦ '));
    }
    process.stdout.write(redactString(text, 2_000));
    if (this.config.showMetrics && elapsedMs > 0) this.lastMetricsLine = this.metricLine(elapsedMs, completionTokens);
  }

  private reasoningStart(): void {
    this.reasoningBuffer = '';
    if (!this.config.showThinking || this.config.thinkingMode === 'hidden') return;
    if (this.config.thinkingMode === 'expanded') process.stdout.write(chalk.yellow('\n\n▸ thinking\n'));
  }

  private reasoningDelta(text: string): void {
    this.reasoningBuffer += text;
    if (!this.config.showThinking || this.config.thinkingMode !== 'expanded') return;
    process.stdout.write(chalk.dim(redactString(text, 1_000)));
  }

  private reasoningEnd(text: string): void {
    const safe = redactString(text || this.reasoningBuffer, 600);
    if (!this.config.showThinking || this.config.thinkingMode === 'hidden' || !safe.trim()) return;
    if (this.config.thinkingMode === 'collapsed') {
      const preview = `${safe.slice(0, 160)}${safe.length > 160 ? '…' : ''}`;
      console.log(chalk.yellow(`\n▸ thinking collapsed (${estimateTokens(safe)} tok) ${chalk.dim(preview)}`));
    } else {
      console.log(chalk.yellow('\n▾ thinking end'));
    }
  }

  private toolCall(toolName: string, inputPreview?: string): void {
    this.toolCalls += 1;
    if (!this.config.showTools) return;
    const input = inputPreview ? ` ${chalk.dim(inputPreview)}` : '';
    console.log(chalk.blue(`\n\n🔧 ${toolName}`) + input);
  }

  private toolResult(toolName: string, outputPreview: string, ok: boolean): void {
    if (!this.config.showTools) return;
    const icon = ok ? '✓' : '✖';
    const color = ok ? chalk.green : chalk.red;
    console.log(color(`${icon} ${toolName}`) + chalk.dim(` ${redactString(outputPreview, 300)}`));
  }

  private finish(event: Extract<StreamingEvent, { type: 'finish' }>): void {
    this.stopTimer();
    if (this.answerStarted) console.log('');
    if (!this.answerStarted && event.text.trim()) console.log(chalk.magentaBright('\n✦ ') + redactString(event.text, 4_000));
    const cost = event.metrics.cost;
    console.log(chalk.cyanBright('\n╭─ Summary'));
    console.log(chalk.gray(`│ duration ${formatDuration(event.elapsedMs)} · output ${event.metrics.completionTokens ?? event.metrics.totalTokens ?? 0} tok · ${event.metrics.responseTokensPerSecond} tok/s`));
    if (typeof event.metrics.promptTokens === 'number' || typeof event.metrics.totalTokens === 'number') console.log(chalk.gray(`│ usage prompt=${event.metrics.promptTokens ?? '?'} completion=${event.metrics.completionTokens ?? '?'} total=${event.metrics.totalTokens ?? '?'}`));
    if (this.config.showCost && cost) console.log(chalk.gray(`│ cost ~${cost.totalCost.toFixed(8)} ${cost.currency} (${cost.pricingSource})`));
    console.log(chalk.gray(`│ tools ${event.toolCallCount}`));
    console.log(chalk.cyanBright('╰────────'));
  }

  private error(message: string, elapsedMs: number): void {
    this.stopTimer();
    console.log(chalk.red(`\n✖ Streaming error after ${formatDuration(elapsedMs)}: ${redactString(message, 500)}`));
  }

  private renderLiveMetrics(): void {
    const elapsed = Date.now() - this.startedAt;
    this.lastMetricsLine = this.metricLine(elapsed, this.completionTokens);
    process.stdout.write(chalk.dim(`\r${this.lastMetricsLine}`));
  }

  private metrics(elapsedMs: number, completionTokens: number, cost?: number, currency?: string): void {
    const costText = typeof cost === 'number' && currency ? ` · ~${cost.toFixed(8)} ${currency}` : '';
    this.lastMetricsLine = `${this.metricLine(elapsedMs, completionTokens)}${costText}`;
  }

  private metricLine(elapsedMs: number, completionTokens: number): string {
    return `⏱ ${formatDuration(elapsedMs)} · out ${completionTokens} tok · ${tokensPerSecond(completionTokens, elapsedMs)} tok/s · tools ${this.toolCalls}`;
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.lastMetricsLine) process.stdout.write('\n');
  }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  const millis = ms % 1000;
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}.${Math.floor(millis / 100)}s`;
}
