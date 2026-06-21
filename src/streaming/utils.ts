import { estimateTokenCost } from '../tokens/index.js';
import { redactString, redactUnknown } from '../policy/redact.js';

export function safePreview(value: unknown, maxChars = 300): string {
  const redacted = redactUnknown(value, { includeContent: true, maxChars, maxDepth: 3, maxArrayItems: 6 });
  const text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return redactString(text ?? '', maxChars);
}

export function estimatedLiveCost(promptTokens: number | undefined, completionTokens: number, pricing: Parameters<typeof estimateTokenCost>[0]['pricing']) {
  return estimateTokenCost({ promptTokens, completionTokens, source: 'estimated', pricing });
}
