import { appendMemoryAudit } from './audit.js';
import { MemoryStore, createMemoryItem } from './store.js';
import type { MemoryDoctorReport, MemoryRuntimeConfig } from './types.js';

export async function archiveExpiredMemory(config: MemoryRuntimeConfig = {}): Promise<{ archived: number }> {
  const store = new MemoryStore(config);
  const index = await store.readIndex();
  let archived = 0;
  for (const entry of index.items) {
    if (entry.staleAfter && Date.parse(entry.staleAfter) < Date.now()) {
      if (await store.archiveItem(entry.id, 'ttl expired')) archived += 1;
    }
  }
  await appendMemoryAudit(store.root, { action: 'archive', counts: { archived }, reason: 'archive expired memory' });
  return { archived };
}

export async function decayMemoryConfidence(config: MemoryRuntimeConfig = {}, factor = 0.95): Promise<{ updated: number }> {
  const store = new MemoryStore(config);
  let updated = 0;
  for (const item of await store.listItems()) {
    if (item.lifecycle.status !== 'active') continue;
    const next = createMemoryItem({ ...item, id: item.id, quality: { ...item.quality, confidence: Math.max(0, Number((item.quality.confidence * factor).toFixed(4))) }, lifecycle: { ...item.lifecycle, updatedAt: new Date().toISOString() } });
    await store.persistItem(next);
    updated += 1;
  }
  await appendMemoryAudit(store.root, { action: 'consolidate', counts: { confidenceDecayed: updated } });
  return { updated };
}

export async function rebuildMemoryIndex(config: MemoryRuntimeConfig = {}) {
  return new MemoryStore(config).rebuildIndex();
}

export async function doctorMemory(config: MemoryRuntimeConfig = {}): Promise<MemoryDoctorReport> {
  return new MemoryStore(config).doctor();
}

export async function consolidateMemory(config: MemoryRuntimeConfig = {}): Promise<{ archived: number; decayed: number }> {
  const archived = await archiveExpiredMemory(config);
  const decayed = await decayMemoryConfidence(config);
  return { archived: archived.archived, decayed: decayed.updated };
}
