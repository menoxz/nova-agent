import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { BatchItem } from './types.js';

const MAX_BATCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 20_000;

export async function loadBatchItems(filePath: string): Promise<{ path: string; items: BatchItem[] }> {
  const path = resolve(filePath);
  const stats = await stat(path).catch((err) => {
    throw new Error(`Batch file not found: ${path}. Pass a .txt or .json file.`);
  });
  if (!stats.isFile()) throw new Error(`Batch input is not a file: ${path}`);
  if (stats.size > MAX_BATCH_FILE_BYTES) throw new Error(`Batch file is too large (${stats.size} bytes > ${MAX_BATCH_FILE_BYTES} bytes): ${path}`);
  const text = await readFile(path, 'utf-8');
  const ext = extname(path).toLowerCase();
  if (ext === '.txt') return { path, items: parseTxtBatch(text) };
  if (ext === '.json') return { path, items: parseJsonBatch(text) };
  throw new Error(`Unsupported batch file extension "${ext || '(none)'}". Supported formats: .txt and .json.`);
}

export function parseTxtBatch(text: string): BatchItem[] {
  const items: BatchItem[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const prompt = rawLine.trim();
    if (!prompt || prompt.startsWith('#') || prompt.startsWith('//')) continue;
    validatePrompt(prompt, `line ${index + 1}`);
    items.push({ id: `line-${index + 1}`, prompt, sourceLine: index + 1 });
  }
  if (!items.length) throw new Error('Batch .txt file contains no prompts. Add one prompt per non-empty line; lines starting with # or // are ignored.');
  return items;
}

export function parseJsonBatch(text: string): BatchItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid batch JSON: ${err instanceof Error ? err.message : String(err)}. Expected an array of { "id": "task-1", "prompt": "..." } objects.`);
  }
  if (!Array.isArray(parsed)) throw new Error('Batch .json must be an array of objects: [{ "id": "task-1", "prompt": "..." }].');
  const seen = new Set<string>();
  const items = parsed.map((entry, index): BatchItem => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Batch JSON item #${index + 1} must be an object with id and prompt.`);
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!id) throw new Error(`Batch JSON item #${index + 1} is missing a non-empty string id.`);
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) throw new Error(`Batch JSON item #${index + 1} has unsafe id "${id}". Use 1-80 chars: letters, numbers, dot, underscore or dash.`);
    if (seen.has(id)) throw new Error(`Batch JSON contains duplicate id "${id}". Each item id must be unique.`);
    seen.add(id);
    validatePrompt(prompt, `item "${id}"`);
    return { id, prompt };
  });
  if (!items.length) throw new Error('Batch .json file contains no items. Expected at least one { "id", "prompt" } object.');
  return items;
}

function validatePrompt(prompt: string, label: string): void {
  if (!prompt) throw new Error(`Batch ${label} has an empty prompt.`);
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`Batch ${label} prompt is too long (${prompt.length} chars > ${MAX_PROMPT_CHARS}).`);
}
