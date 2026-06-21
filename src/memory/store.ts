import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEMORY_SCHEMA_HASH, assertValidMemoryItem, parseMemoryItem } from './schema.js';
import { appendMemoryAudit } from './audit.js';
import { archivePath, canonicalJson, ensureMemoryLayout, indexPath, itemPath, memoryPath, memoryRoot, migrationsPath, schemaPath, sha256, writeJsonAtomic } from './paths.js';
import { MEMORY_SCHEMA_VERSION, type MemoryDoctorReport, type MemoryIndex, type MemoryIndexEntry, type MemoryItem, type MemoryItemType, type MemoryRuntimeConfig } from './types.js';

export class MemoryStore {
  public readonly root: string;

  constructor(config: MemoryRuntimeConfig = {}) {
    this.root = memoryRoot(config.projectRoot, config.memoryRoot);
  }

  async init(): Promise<void> {
    await ensureMemoryLayout(this.root);
    await writeJsonAtomic(schemaPath(this.root), { schemaVersion: MEMORY_SCHEMA_VERSION, schemaHash: MEMORY_SCHEMA_HASH, updatedAt: new Date().toISOString() });
    try { await readFile(migrationsPath(this.root), 'utf-8'); } catch { await writeJsonAtomic(migrationsPath(this.root), { schemaVersion: MEMORY_SCHEMA_VERSION, applied: [] }); }
    try { await readFile(indexPath(this.root), 'utf-8'); } catch { await this.writeIndex(emptyIndex()); }
  }

  async readIndex(): Promise<MemoryIndex> {
    await this.init();
    try {
      return JSON.parse(await readFile(indexPath(this.root), 'utf-8')) as MemoryIndex;
    } catch {
      return this.rebuildIndex();
    }
  }

  async writeIndex(index: MemoryIndex): Promise<void> {
    const withoutHash = { ...index, integrity: { ...index.integrity, indexHash: '' } };
    const hash = sha256(canonicalJson(withoutHash));
    await writeJsonAtomic(indexPath(this.root), { ...index, integrity: { itemCount: index.items.length, indexHash: hash } });
  }

  async persistItem(item: MemoryItem): Promise<void> {
    await this.init();
    const valid = assertValidMemoryItem(item) as MemoryItem;
    await writeJsonAtomic(itemPath(this.root, valid.type, valid.id), valid);
    const index = await this.readIndex();
    const entry = indexEntry(valid);
    const nextItems = index.items.filter((existing) => existing.id !== valid.id);
    nextItems.push(entry);
    await this.writeIndex(buildIndex(nextItems));
    await this.writeCollectionManifest(valid.collection, nextItems.filter((candidate) => candidate.collection === valid.collection));
  }

  async getItem(id: string): Promise<MemoryItem | undefined> {
    const index = await this.readIndex();
    const entry = index.items.find((item) => item.id === id);
    if (!entry) return undefined;
    const parsed = JSON.parse(await readFile(itemPath(this.root, entry.type, id), 'utf-8'));
    const result = parseMemoryItem(parsed);
    return result.success ? result.data as MemoryItem : undefined;
  }

  async listItems(): Promise<MemoryItem[]> {
    await this.init();
    const files = await collectJsonFiles(memoryPath(this.root, 'items'));
    const items: MemoryItem[] = [];
    for (const file of files) {
      try {
        const parsed = parseMemoryItem(JSON.parse(await readFile(file, 'utf-8')));
        if (parsed.success) items.push(parsed.data as MemoryItem);
      } catch { /* corrupt items are handled by doctor/rebuild */ }
    }
    return items;
  }

  async archiveItem(id: string, reason = 'archive requested'): Promise<boolean> {
    const item = await this.getItem(id);
    if (!item) return false;
    const now = new Date().toISOString();
    item.lifecycle.status = 'archived';
    item.lifecycle.archivedAt = now;
    item.lifecycle.updatedAt = now;
    await mkdir(dirname(archivePath(this.root, item.type, item.id)), { recursive: true });
    await cp(itemPath(this.root, item.type, item.id), archivePath(this.root, item.type, item.id));
    await rm(itemPath(this.root, item.type, item.id), { force: true });
    const index = await this.readIndex();
    await this.writeIndex(buildIndex(index.items.filter((entry) => entry.id !== id)));
    await appendMemoryAudit(this.root, { action: 'archive', itemId: id, fingerprint: item.integrity.fingerprint, collection: item.collection, scopeKind: item.scope.kind, reason });
    return true;
  }

  async deleteItem(id: string, reason = 'delete requested'): Promise<boolean> {
    const index = await this.readIndex();
    const entry = index.items.find((item) => item.id === id);
    if (!entry) return false;
    await rm(itemPath(this.root, entry.type, id), { force: true });
    await this.writeIndex(buildIndex(index.items.filter((item) => item.id !== id)));
    await appendMemoryAudit(this.root, { action: 'delete', itemId: id, fingerprint: entry.fingerprint, collection: entry.collection, scopeKind: entry.scope.kind, reason });
    return true;
  }

  async rebuildIndex(): Promise<MemoryIndex> {
    await ensureMemoryLayout(this.root);
    const items = await this.listItems();
    const entries = items.map(indexEntry);
    const index = buildIndex(entries);
    await this.writeIndex(index);
    await appendMemoryAudit(this.root, { action: 'rebuild-index', counts: { indexed: entries.length } });
    return this.readIndexRaw();
  }

  async doctor(): Promise<MemoryDoctorReport> {
    await this.init();
    const report: MemoryDoctorReport = { checked: 0, corrupt: 0, archived: 0, skipped: [] };
    for (const file of await collectJsonFiles(memoryPath(this.root, 'items'))) {
      report.checked += 1;
      try {
        const parsed = parseMemoryItem(JSON.parse(await readFile(file, 'utf-8')));
        if (!parsed.success) throw new Error(parsed.error.message);
        const item = parsed.data as MemoryItem;
        if (item.integrity.contentHash !== hashContent(item) || item.integrity.schemaHash !== MEMORY_SCHEMA_HASH) {
          throw new Error('memory hash mismatch');
        }
      } catch (err) {
        report.corrupt += 1;
        report.skipped.push({ path: file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    report.rebuiltIndexHash = (await this.rebuildIndex()).integrity.indexHash;
    await appendMemoryAudit(this.root, { action: 'doctor', counts: { checked: report.checked, corrupt: report.corrupt } });
    return report;
  }

  private async readIndexRaw(): Promise<MemoryIndex> {
    return JSON.parse(await readFile(indexPath(this.root), 'utf-8')) as MemoryIndex;
  }

  private async writeCollectionManifest(collection: string, entries: MemoryIndexEntry[]): Promise<void> {
    await writeJsonAtomic(memoryPath(this.root, 'collections', `${collection}.json`), { schemaVersion: MEMORY_SCHEMA_VERSION, id: collection, itemIds: entries.map((entry) => entry.id), updatedAt: new Date().toISOString() });
  }
}

export function createMemoryItem(input: Omit<MemoryItem, 'schemaVersion' | 'id' | 'integrity'> & { id?: string }): MemoryItem {
  const id = input.id ?? `mem_${randomUUID()}`;
  const draft = { ...input, schemaVersion: MEMORY_SCHEMA_VERSION, id } as MemoryItem;
  draft.integrity = {
    contentHash: hashContent(draft),
    fingerprint: fingerprint(draft),
    schemaHash: MEMORY_SCHEMA_HASH,
  };
  return draft;
}

export function hashContent(item: Pick<MemoryItem, 'content'>): string {
  return sha256(canonicalJson(item.content).toLowerCase());
}

export function fingerprint(item: Pick<MemoryItem, 'type' | 'collection' | 'scope' | 'content' | 'source'>): string {
  return sha256(canonicalJson({ type: item.type, collection: item.collection, scope: item.scope, content: item.content, source: { kind: item.source.kind, profileId: item.source.profileId } }).toLowerCase());
}

export function indexEntry(item: MemoryItem): MemoryIndexEntry {
  return {
    id: item.id,
    type: item.type,
    collection: item.collection,
    scope: item.scope,
    title: item.content.title,
    summaryPreview: item.content.summary.slice(0, 300),
    tags: item.content.tags,
    confidence: item.quality.confidence,
    importance: item.quality.importance,
    createdAt: item.lifecycle.createdAt,
    updatedAt: item.lifecycle.updatedAt,
    staleAfter: item.quality.staleAfter,
    lastVerifiedAt: item.quality.lastVerifiedAt,
    status: item.lifecycle.status,
    contentHash: item.integrity.contentHash,
    fingerprint: item.integrity.fingerprint,
    sourceKind: item.source.kind,
    redacted: item.security.redacted,
    injectionRisk: item.security.injectionRisk,
  };
}

function emptyIndex(): MemoryIndex {
  return buildIndex([]);
}

function buildIndex(items: MemoryIndexEntry[]): MemoryIndex {
  const collections = Array.from(new Set(items.map((item) => item.collection))).sort().map((id) => {
    const entries = items.filter((item) => item.collection === id);
    return { id, count: entries.length, lastUpdatedAt: entries.map((entry) => entry.updatedAt).sort().at(-1) };
  });
  return { schemaVersion: MEMORY_SCHEMA_VERSION, generatedAt: new Date().toISOString(), storeVersion: 'memory-v1', items: items.sort((a, b) => a.id.localeCompare(b.id)), collections, migrations: [], integrity: { itemCount: items.length, indexHash: '' } };
}

async function collectJsonFiles(dir: string): Promise<string[]> {
  try { await stat(dir); } catch { return []; }
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = memoryPath(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectJsonFiles(path));
    if (entry.isFile() && entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}
