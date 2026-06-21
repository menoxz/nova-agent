import type { MemoryRetrievalResult } from './types.js';

export function injectMemoryIntoSystemPrompt(systemPrompt: string, retrieval: MemoryRetrievalResult): string {
  if (!retrieval.contextBlock.trim()) return systemPrompt;
  return [systemPrompt, '', '## Long-term Memory Context', retrieval.contextBlock].join('\n');
}

export function memorySummaryForMetadata(retrieval?: MemoryRetrievalResult) {
  return retrieval?.summary ?? { retrievedIds: [], retrievedCount: 0, retrievedChars: 0 };
}
