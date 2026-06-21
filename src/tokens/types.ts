export type TokenMeasurementSource = 'provider' | 'estimated' | 'mixed';

export interface TokenUsageMeasurement {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  source: TokenMeasurementSource;
}

export interface LlmPricingConfig {
  /** Currency code used for estimated cost, e.g. USD, EUR, XOF. */
  currency: string;
  /** Input/prompt price per one million tokens. */
  inputCostPer1MTokens?: number;
  /** Output/completion price per one million tokens. */
  outputCostPer1MTokens?: number;
  /** Human-readable source of the pricing table, e.g. env, provider-docs-2026-06. */
  source?: string;
}

export interface TokenCostEstimate {
  currency: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  pricingUnit: 'per_1m_tokens';
  pricingSource: string;
  estimated: boolean;
}

export interface ResponseTokenMetrics extends TokenUsageMeasurement {
  responseDurationMs: number;
  responseTokensPerSecond: number;
  cost?: TokenCostEstimate;
}

export interface TokenCompactionResult {
  text: string;
  originalTokens: number;
  compactedTokens: number;
  compacted: boolean;
  reason?: string;
  omittedLines: number;
}
