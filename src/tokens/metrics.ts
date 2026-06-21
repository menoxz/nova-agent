import type { LlmPricingConfig, ResponseTokenMetrics, TokenCostEstimate, TokenUsageMeasurement } from './types.js';

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokenUsage(input: { promptText?: string; completionText?: string }): TokenUsageMeasurement {
  const promptTokens = input.promptText ? estimateTokens(input.promptText) : undefined;
  const completionTokens = input.completionText ? estimateTokens(input.completionText) : undefined;
  const totalTokens = typeof promptTokens === 'number' || typeof completionTokens === 'number'
    ? (promptTokens ?? 0) + (completionTokens ?? 0)
    : undefined;
  return { promptTokens, completionTokens, totalTokens, source: 'estimated' };
}

export function extractTokenUsage(value: unknown): TokenUsageMeasurement | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const candidates = [record.usage, record.totalUsage, record.providerMetadata, record].filter(Boolean);
  for (const candidate of candidates) {
    const usage = normalizeUsage(candidate);
    if (usage) return usage;
  }
  return undefined;
}

export function responseTokenMetrics(input: { usage?: TokenUsageMeasurement; promptText?: string; completionText: string; responseDurationMs: number; pricing?: LlmPricingConfig }): ResponseTokenMetrics {
  const estimated = estimateTokenUsage({ promptText: input.promptText, completionText: input.completionText });
  const promptTokens = input.usage?.promptTokens ?? estimated.promptTokens;
  const completionTokens = input.usage?.completionTokens ?? estimated.completionTokens ?? estimateTokens(input.completionText);
  const totalTokens = input.usage?.totalTokens ?? ((promptTokens ?? 0) + completionTokens);
  const source = input.usage?.source === 'provider'
    ? (typeof input.usage.promptTokens === 'number' && typeof input.usage.completionTokens === 'number' ? 'provider' : 'mixed')
    : 'estimated';
  const metrics: ResponseTokenMetrics = {
    promptTokens,
    completionTokens,
    totalTokens,
    source,
    responseDurationMs: input.responseDurationMs,
    responseTokensPerSecond: tokensPerSecond(completionTokens, input.responseDurationMs),
  };
  const cost = estimateTokenCost({ promptTokens, completionTokens, source, pricing: input.pricing });
  if (cost) metrics.cost = cost;
  return metrics;
}

export function estimateTokenCost(input: { promptTokens?: number; completionTokens?: number; source: TokenUsageMeasurement['source']; pricing?: LlmPricingConfig }): TokenCostEstimate | undefined {
  const pricing = normalizePricing(input.pricing);
  if (!pricing) return undefined;
  const inputCost = costPart(input.promptTokens, pricing.inputCostPer1MTokens);
  const outputCost = costPart(input.completionTokens, pricing.outputCostPer1MTokens);
  return {
    currency: pricing.currency,
    inputCost,
    outputCost,
    totalCost: roundMoney(inputCost + outputCost),
    pricingUnit: 'per_1m_tokens',
    pricingSource: pricing.source ?? 'configured',
    estimated: true,
  };
}

export function tokensPerSecond(tokens: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Number((tokens / (durationMs / 1_000)).toFixed(2));
}

function normalizeUsage(value: unknown): TokenUsageMeasurement | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const promptTokens = firstNumber(record, ['promptTokens', 'inputTokens', 'prompt_tokens', 'input_tokens']);
  const completionTokens = firstNumber(record, ['completionTokens', 'outputTokens', 'completion_tokens', 'output_tokens']);
  const totalTokens = firstNumber(record, ['totalTokens', 'total_tokens']) ?? (typeof promptTokens === 'number' || typeof completionTokens === 'number' ? (promptTokens ?? 0) + (completionTokens ?? 0) : undefined);
  if (typeof promptTokens !== 'number' && typeof completionTokens !== 'number' && typeof totalTokens !== 'number') return undefined;
  return { promptTokens, completionTokens, totalTokens, source: 'provider' };
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function normalizePricing(pricing?: LlmPricingConfig): LlmPricingConfig | undefined {
  if (!pricing) return undefined;
  const input = positiveOrZero(pricing.inputCostPer1MTokens);
  const output = positiveOrZero(pricing.outputCostPer1MTokens);
  if (typeof input !== 'number' && typeof output !== 'number') return undefined;
  return { currency: (pricing.currency || 'USD').toUpperCase(), inputCostPer1MTokens: input, outputCostPer1MTokens: output, source: pricing.source };
}

function costPart(tokens: number | undefined, pricePer1M: number | undefined): number {
  if (typeof tokens !== 'number' || typeof pricePer1M !== 'number') return 0;
  return roundMoney((tokens / 1_000_000) * pricePer1M);
}

function positiveOrZero(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(8));
}
