export const DEFAULT_OUTPUT_MAX_CHARS = 40_000;
export const HARD_OUTPUT_MAX_CHARS = 120_000;

export function clampOutputLimit(value: unknown, fallback = DEFAULT_OUTPUT_MAX_CHARS, hardMax = HARD_OUTPUT_MAX_CHARS): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1_000, Math.min(hardMax, n));
}

export function capText(text: string, maxChars = DEFAULT_OUTPUT_MAX_CHARS): { text: string; truncated: boolean; originalChars: number; maxChars: number } {
  const bounded = clampOutputLimit(maxChars, DEFAULT_OUTPUT_MAX_CHARS, HARD_OUTPUT_MAX_CHARS);
  const originalChars = text.length;
  if (originalChars <= bounded) return { text, truncated: false, originalChars, maxChars: bounded };
  return { text: `${text.slice(0, bounded)}\n...(truncated ${originalChars - bounded} chars)`, truncated: true, originalChars, maxChars: bounded };
}
