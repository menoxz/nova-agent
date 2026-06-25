import { writeMemory } from './writer.js';
import { retrieveMemory } from './retrieval.js';
import { doctorMemory, rebuildMemoryIndex } from './lifecycle.js';
import { readMemoryRagIndex, rebuildMemoryRagIndex, searchMemoryRag } from './indexer.js';
import { MemoryStore } from './store.js';
import type { MemoryItemType, MemoryRuntimeConfig, MemoryScopeKind } from './types.js';

export async function handleMemoryCommand(args: string[], config: MemoryRuntimeConfig = {}): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'memory') return false;
  const runtime = { ...config, enabled: true, approvalProvided: true, policyProfileId: config.policyProfileId ?? 'developer' };
  if (action === 'list') {
    const store = new MemoryStore(runtime);
    const items = await store.readIndex();
    console.log(JSON.stringify({ count: items.items.length, collections: items.collections, items: items.items.map(({ id, type, collection, scope, title, tags, updatedAt }) => ({ id, type, collection, scope: scope.kind, title, tags, updatedAt })) }, null, 2));
    return true;
  }
  if (action === 'show' && rest[0]) {
    const item = await new MemoryStore(runtime).getItem(rest[0]);
    console.log(JSON.stringify(item ? { ...item, content: { ...item.content, body: item.content.body ? '[body omitted: use memory search/retrieve snippets]' : undefined } } : null, null, 2));
    return true;
  }
  if (action === 'add') {
    const title = option(rest, 'title') ?? rest.find((value) => !value.startsWith('--'));
    const summary = option(rest, 'summary') ?? option(rest, 'body');
    if (!title || !summary) throw new Error('Usage: nova memory add --title <title> --summary <summary> [--tags a,b] [--collection project_knowledge] [--type semantic] [--scope project]');
    const result = await writeMemory({
      type: memoryType(option(rest, 'type')),
      collection: option(rest, 'collection') ?? 'project_knowledge',
      scope: { kind: memoryScope(option(rest, 'scope')), projectId: option(rest, 'project') ?? 'nova-agent' },
      content: { title, summary, body: option(rest, 'body'), tags: csv(option(rest, 'tags')) },
      source: { kind: 'manual', createdFrom: 'cli-memory-add' },
      quality: { confidence: numberOption(rest, 'confidence', 0.85), importance: numberOption(rest, 'importance', 0.7), lastVerifiedAt: new Date().toISOString() },
    }, runtime);
    console.log(JSON.stringify({ status: result.status, id: result.item?.id, existingId: result.existingId, reason: result.reason }, null, 2));
    return true;
  }
  if ((action === 'search' || action === 'retrieve') && rest.length) {
    const query = rest.filter((value) => !value.startsWith('--') && !previousIsOption(rest, value)).join(' ');
    const retrieval = await retrieveMemory({ ...runtime, query, tokenBudget: numberOption(rest, 'budget', runtime.tokenBudget ?? 900) });
    console.log(action === 'retrieve' ? retrieval.contextBlock : JSON.stringify({ count: retrieval.cards.length, cards: retrieval.cards, omitted: retrieval.omitted, indexHash: retrieval.indexHash }, null, 2));
    return true;
  }
  if (action === 'rag' && rest[0] === 'search' && rest.slice(1).length) {
    console.log(JSON.stringify(await searchMemoryRag(rest.slice(1).join(' '), runtime, { limit: numberOption(rest, 'limit', 8) }), null, 2));
    return true;
  }
  if (action === 'rag' && rest[0] === 'rebuild') { const index = await rebuildMemoryRagIndex(runtime); console.log(JSON.stringify({ chunkCount: index.chunkCount, generatedAt: index.generatedAt, algorithm: index.algorithm, hash: index.integrity.ragIndexHash }, null, 2)); return true; }
  if (action === 'rag' && rest[0] === 'status') { const index = await readMemoryRagIndex(runtime); console.log(JSON.stringify({ chunkCount: index.chunkCount, generatedAt: index.generatedAt, algorithm: index.algorithm, hash: index.integrity.ragIndexHash }, null, 2)); return true; }
  if (action === 'rebuild-index') { console.log(JSON.stringify(await rebuildMemoryIndex(runtime), null, 2)); return true; }
  if (action === 'doctor') { console.log(JSON.stringify(await doctorMemory(runtime), null, 2)); return true; }
  throw new Error('Usage: nova memory list|show|add|search|retrieve|rag status|rag rebuild|rag search|rebuild-index|doctor');
}

function option(args: string[], name: string): string | undefined {
  const direct = args.indexOf(`--${name}`);
  if (direct >= 0) return args[direct + 1];
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function previousIsOption(args: string[], value: string): boolean {
  const index = args.indexOf(value);
  return index > 0 && args[index - 1]?.startsWith('--') && !args[index - 1]?.includes('=');
}

function csv(value?: string): string[] { return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []; }
function numberOption(args: string[], name: string, fallback: number): number { const parsed = Number(option(args, name)); return Number.isFinite(parsed) ? parsed : fallback; }
function memoryType(value?: string): MemoryItemType { return ['semantic', 'episodic', 'procedural', 'profile', 'decision', 'finding'].includes(value ?? '') ? value as MemoryItemType : 'semantic'; }
function memoryScope(value?: string): MemoryScopeKind { return ['project', 'workspace', 'profile', 'session', 'user', 'subagent', 'capability'].includes(value ?? '') ? value as MemoryScopeKind : 'project'; }
