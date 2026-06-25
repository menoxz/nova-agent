import { readFile } from 'node:fs/promises';

import { MEMORY_SCHEMA_HASH } from './schema.js';
import { canonicalJson, ragIndexPath, sha256, writeJsonAtomic } from './paths.js';
import { MemoryStore, fingerprint, hashContent, indexEntry } from './store.js';
import { MEMORY_SCHEMA_VERSION, type MemoryItem, type MemoryRagChunk, type MemoryRagHit, type MemoryRagIndex, type MemoryRuntimeConfig } from './types.js';

export { indexEntry, hashContent, fingerprint } from './store.js';
export type { MemoryIndex, MemoryIndexEntry, MemoryRagChunk, MemoryRagHit, MemoryRagIndex } from './types.js';

const MAX_CHUNK_CHARS = 1_200;
const MAX_QUERY_TERMS = 24;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'dans', 'pour', 'avec', 'les', 'des', 'une', 'est', 'sur', 'aux']);

export async function rebuildMemoryRagIndex(config: MemoryRuntimeConfig = {}): Promise<MemoryRagIndex> {
  const store = new MemoryStore(config);
  const items = (await store.listItems()).filter((item) => item.lifecycle.status === 'active' && item.integrity.contentHash === hashContent(item) && item.integrity.schemaHash === MEMORY_SCHEMA_HASH);
  const index = buildMemoryRagIndex(items);
  await writeJsonAtomic(ragIndexPath(store.root), index);
  return index;
}

export async function readMemoryRagIndex(config: MemoryRuntimeConfig = {}): Promise<MemoryRagIndex> {
  const store = new MemoryStore(config);
  await store.init();
  try {
    return JSON.parse(await readFile(ragIndexPath(store.root), 'utf-8')) as MemoryRagIndex;
  } catch {
    return rebuildMemoryRagIndex(config);
  }
}

export function buildMemoryRagIndex(items: MemoryItem[]): MemoryRagIndex {
  const chunks = items.flatMap(itemToChunks);
  const documentFrequency: Record<string, number> = {};
  for (const chunk of chunks) {
    for (const term of Object.keys(chunk.termFrequency)) documentFrequency[term] = (documentFrequency[term] ?? 0) + 1;
  }
  const draft: MemoryRagIndex = { schemaVersion: MEMORY_SCHEMA_VERSION, generatedAt: new Date().toISOString(), algorithm: 'local-bm25-lite', chunkCount: chunks.length, documentFrequency, chunks, integrity: { ragIndexHash: '' } };
  return { ...draft, integrity: { ragIndexHash: sha256(canonicalJson(draft)) } };
}

export async function searchMemoryRag(query: string, config: MemoryRuntimeConfig = {}, options: { limit?: number; allowedItemIds?: string[] } = {}): Promise<MemoryRagHit[]> {
  const index = await readMemoryRagIndex(config);
  const allowed = options.allowedItemIds ? new Set(options.allowedItemIds) : undefined;
  return searchMemoryRagIndex(query, index, { limit: options.limit, allowedItemIds: allowed });
}

export function searchMemoryRagIndex(query: string, index: MemoryRagIndex, options: { limit?: number; allowedItemIds?: Set<string> } = {}): MemoryRagHit[] {
  const queryTerms = tokenize(query).slice(0, MAX_QUERY_TERMS);
  if (!queryTerms.length) return [];
  const total = Math.max(1, index.chunkCount);
  const hits: MemoryRagHit[] = [];
  for (const chunk of index.chunks) {
    if (options.allowedItemIds && !options.allowedItemIds.has(chunk.itemId)) continue;
    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of queryTerms) {
      const tf = chunk.termFrequency[term] ?? 0;
      if (!tf) continue;
      matchedTerms.push(term);
      const df = index.documentFrequency[term] ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += ((tf * 2.2) / (tf + 1.2)) * idf;
      if (chunk.tags.includes(term)) score += 1.5;
      if (chunk.title.toLowerCase().includes(term)) score += 1;
    }
    if (score > 0) hits.push({ itemId: chunk.itemId, chunkId: chunk.id, score: Number(score.toFixed(4)), title: chunk.title, snippet: snippetFor(chunk.text, matchedTerms), matchedTerms: [...new Set(matchedTerms)] });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 8);
}

function itemToChunks(item: MemoryItem): MemoryRagChunk[] {
  const body = [item.content.summary, item.content.body].filter(Boolean).join('\n\n');
  const pieces = chunkText(body || item.content.title, MAX_CHUNK_CHARS);
  return pieces.map((text, index) => {
    const fullText = [item.content.title, item.content.tags.join(' '), text].join('\n');
    const terms = tokenize(fullText);
    return { id: `${item.id}#${index}`, itemId: item.id, collection: item.collection, scope: item.scope, type: item.type, title: item.content.title, text, tags: item.content.tags.map((tag) => tag.toLowerCase()), tokenCount: terms.length, termFrequency: frequency(terms), contentHash: item.integrity.contentHash, updatedAt: item.lifecycle.updatedAt };
  });
}

function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += maxChars) chunks.push(normalized.slice(start, start + maxChars));
  return chunks;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9_.-]+/).filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

function frequency(terms: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const term of terms) out[term] = (out[term] ?? 0) + 1;
  return out;
}

function snippetFor(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const first = terms.map((term) => lower.indexOf(term)).filter((idx) => idx >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 80);
  const end = Math.min(text.length, first + 220);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
