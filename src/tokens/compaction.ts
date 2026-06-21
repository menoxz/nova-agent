import { estimateTokens } from './metrics.js';
import type { TokenCompactionResult } from './types.js';

export function compactTextToTokenBudget(text: string, maxTokens: number, options: { preserveHeadLines?: number; preserveTailLines?: number; reason?: string } = {}): TokenCompactionResult {
  const originalTokens = estimateTokens(text);
  if (originalTokens <= maxTokens) {
    return { text, originalTokens, compactedTokens: originalTokens, compacted: false, omittedLines: 0 };
  }

  const lines = text.split(/\r?\n/);
  const headCount = Math.max(1, options.preserveHeadLines ?? 8);
  const tailCount = Math.max(0, options.preserveTailLines ?? 1);
  const head: string[] = [];
  const tail = tailCount > 0 ? lines.slice(-tailCount) : [];
  const marker = (omitted: number) => `[... compacted ${omitted} lines to fit token budget: ${options.reason ?? 'budget'} ...]`;

  for (const line of lines.slice(0, Math.max(0, lines.length - tail.length))) {
    const omitted = Math.max(0, lines.length - head.length - tail.length);
    const candidate = [...head, line, marker(Math.max(0, omitted - 1)), ...tail].join('\n');
    if (estimateTokens(candidate) > maxTokens) break;
    head.push(line);
  }

  let omittedLines = Math.max(0, lines.length - head.length - tail.length);
  let compactedText = [...head, marker(omittedLines), ...tail].join('\n');
  while (estimateTokens(compactedText) > maxTokens && head.length > 1) {
    head.pop();
    omittedLines = Math.max(0, lines.length - head.length - tail.length);
    compactedText = [...head, marker(omittedLines), ...tail].join('\n');
  }
  if (estimateTokens(compactedText) > maxTokens) {
    const maxChars = Math.max(80, maxTokens * 4);
    compactedText = `${text.slice(0, Math.max(0, maxChars - 120)).trimEnd()}\n${marker(lines.length - 1)}`;
  }
  return { text: compactedText, originalTokens, compactedTokens: estimateTokens(compactedText), compacted: true, reason: options.reason ?? 'budget', omittedLines };
}
