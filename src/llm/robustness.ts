import { redactString } from '../policy/redact.js';

export type LlmErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'endpoint_incompatible' | 'network' | 'provider_5xx' | 'unknown';

export interface LlmRobustnessConfig {
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
  retryBackoffMultiplier?: number;
}

export interface ClassifiedLlmError {
  kind: LlmErrorKind;
  retryable: boolean;
  statusCode?: number;
  message: string;
  diagnostic: string;
}

export const DEFAULT_LLM_ROBUSTNESS: Required<LlmRobustnessConfig> = {
  timeoutMs: 60_000,
  retries: 1,
  retryBackoffMs: 750,
  retryBackoffMultiplier: 2,
};

export function resolveLlmRobustnessConfig(config?: LlmRobustnessConfig): Required<LlmRobustnessConfig> {
  return {
    timeoutMs: positiveInt(config?.timeoutMs, DEFAULT_LLM_ROBUSTNESS.timeoutMs),
    retries: Math.min(5, Math.max(0, positiveInt(config?.retries, DEFAULT_LLM_ROBUSTNESS.retries))),
    retryBackoffMs: positiveInt(config?.retryBackoffMs, DEFAULT_LLM_ROBUSTNESS.retryBackoffMs),
    retryBackoffMultiplier: typeof config?.retryBackoffMultiplier === 'number' && Number.isFinite(config.retryBackoffMultiplier) && config.retryBackoffMultiplier >= 1 ? config.retryBackoffMultiplier : DEFAULT_LLM_ROBUSTNESS.retryBackoffMultiplier,
  };
}

export function classifyLlmError(error: unknown): ClassifiedLlmError {
  const message = redactString(errorMessage(error), 1_000);
  const statusCode = errorStatusCode(error);
  const haystack = `${message} ${JSON.stringify(errorObject(error)).slice(0, 2_000)}`.toLowerCase();
  if (isAbortLike(error) || /timeout|timed out|aborterror|aborted/.test(haystack)) return classified('timeout', true, statusCode, message, 'LLM request timed out or was aborted. Increase timeout or retry later.');
  if (statusCode === 401 || statusCode === 403 || /unauthorized|forbidden|invalid api key|authentication|auth/.test(haystack)) return classified('auth', false, statusCode, message, 'LLM authentication failed. Check LLM_API_KEY, provider and account access.');
  if (statusCode === 429 || /rate limit|too many requests|quota/.test(haystack)) return classified('rate_limit', true, statusCode, message, 'LLM provider rate limit or quota reached. Retry with backoff or reduce concurrency.');
  if (statusCode === 404 || /route not found|not_found|not found|unsupported endpoint|endpoint/.test(haystack)) return classified('endpoint_incompatible', false, statusCode, message, 'LLM endpoint appears incompatible with the configured provider adapter. Check /v1/messages vs /v1/chat/completions and LLM_PROVIDER/base URL.');
  if (typeof statusCode === 'number' && statusCode >= 500) return classified('provider_5xx', true, statusCode, message, 'LLM provider returned a 5xx error. Retry later or inspect provider status.');
  if (/fetch failed|cannot connect|econnreset|enotfound|eai_again|network|socket|tls|connection|bad port/.test(haystack)) return classified('network', true, statusCode, message, 'Network error while contacting LLM provider. Check connectivity, DNS, proxy or provider availability.');
  return classified('unknown', false, statusCode, message, 'Unknown LLM error. Inspect provider configuration and safe logs.');
}

export function formatLlmError(error: unknown, input?: { provider?: string; model?: string; baseUrl?: string }): string {
  const classifiedError = classifyLlmError(error);
  const status = classifiedError.statusCode ? ` status=${classifiedError.statusCode}` : '';
  const target = [input?.provider, input?.model].filter(Boolean).join('/');
  const targetText = target ? ` provider=${target}` : '';
  const baseUrl = input?.baseUrl ? ` endpoint=${redactString(input.baseUrl, 200)}` : '';
  return `LLM ${classifiedError.kind}${status}${targetText}${baseUrl}: ${classifiedError.diagnostic} (${classifiedError.message})`;
}

export async function withLlmRetry<T>(operation: (attempt: number) => Promise<T>, config?: LlmRobustnessConfig, hooks: { onRetry?: (input: { attempt: number; nextAttempt: number; delayMs: number; error: ClassifiedLlmError }) => void | Promise<void>; canRetry?: (input: { attempt: number; error: ClassifiedLlmError }) => boolean } = {}): Promise<T> {
  const resolved = resolveLlmRobustnessConfig(config);
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (err) {
      const classifiedError = classifyLlmError(err);
      const canRetry = attempt <= resolved.retries && classifiedError.retryable && (hooks.canRetry?.({ attempt, error: classifiedError }) ?? true);
      if (!canRetry) throw err;
      const delayMs = Math.round(resolved.retryBackoffMs * Math.pow(resolved.retryBackoffMultiplier, attempt - 1));
      await hooks.onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error: classifiedError });
      await sleep(delayMs);
    }
  }
}

function classified(kind: LlmErrorKind, retryable: boolean, statusCode: number | undefined, message: string, diagnostic: string): ClassifiedLlmError {
  return { kind, retryable, statusCode, message, diagnostic };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorObject(error: unknown): Record<string, unknown> {
  return typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
}

function errorStatusCode(error: unknown): number | undefined {
  const record = errorObject(error);
  for (const key of ['statusCode', 'status', 'responseStatusCode']) {
    const value = record[key];
    if (typeof value === 'number') return value;
  }
  const response = record.response;
  if (typeof response === 'object' && response !== null && typeof (response as Record<string, unknown>).status === 'number') return (response as Record<string, number>).status;
  return undefined;
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError' || error instanceof Error && error.name === 'AbortError';
}
