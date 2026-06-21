import { appendMemoryAudit } from './audit.js';
import { MemoryStore } from './store.js';
import { writeMemory } from './writer.js';
import type { MemoryItem, MemoryItemType, MemoryRuntimeConfig, MemoryScopeKind, MemoryWriteResult } from './types.js';

export const EDITABLE_USER_ORG_COLLECTIONS = [
  'user_profile',
  'user_preferences',
  'organization_profile',
  'organization_policies',
  'organization_stack',
  'organization_glossary',
  'organization_constraints',
] as const;

export type EditableUserOrgCollection = typeof EDITABLE_USER_ORG_COLLECTIONS[number];

export interface EditableMemoryUpsertInput {
  collection: EditableUserOrgCollection;
  key: string;
  title: string;
  summary: string;
  body?: string;
  tags?: string[];
  scope?: MemoryScopeKind;
  userId?: string;
  type?: MemoryItemType;
  confidence?: number;
  importance?: number;
}

export async function listEditableUserOrgMemory(config: MemoryRuntimeConfig = {}): Promise<MemoryItem[]> {
  const store = new MemoryStore(config);
  return (await store.listItems()).filter((item) => EDITABLE_USER_ORG_COLLECTIONS.includes(item.collection as EditableUserOrgCollection) && item.lifecycle.status === 'active');
}

export async function upsertEditableUserOrgMemory(input: EditableMemoryUpsertInput, config: MemoryRuntimeConfig = {}): Promise<MemoryWriteResult> {
  assertEditableCollection(input.collection);
  const normalizedKey = normalizeKey(input.key);
  const store = new MemoryStore(config);
  const existing = (await listEditableUserOrgMemory(config)).filter((item) => item.collection === input.collection && item.content.tags.includes(`key:${normalizedKey}`));
  for (const item of existing) await store.archiveItem(item.id, `editable upsert replaced key:${normalizedKey}`);
  const result = await writeMemory({
    type: input.type ?? 'profile',
    collection: input.collection,
    scope: { kind: input.scope ?? (input.collection.startsWith('user_') ? 'user' : 'workspace'), userId: input.userId },
    content: { title: input.title, summary: input.summary, body: input.body, tags: [...new Set([`key:${normalizedKey}`, ...(input.tags ?? [])])] },
    source: { kind: 'user', createdFrom: 'editable_user_org_memory', reference: normalizedKey },
    quality: { confidence: input.confidence ?? 1, importance: input.importance ?? 0.8, lastVerifiedAt: new Date().toISOString() },
  }, config);
  await appendMemoryAudit(store.root, { action: 'write', collection: input.collection, scopeKind: input.scope ?? 'user', decision: result.status, reason: `editable upsert key:${normalizedKey}` });
  return result;
}

export async function deleteEditableUserOrgMemory(collection: EditableUserOrgCollection, key: string, config: MemoryRuntimeConfig = {}): Promise<{ deleted: number }> {
  assertEditableCollection(collection);
  const normalizedKey = normalizeKey(key);
  const store = new MemoryStore(config);
  const items = (await listEditableUserOrgMemory(config)).filter((item) => item.collection === collection && item.content.tags.includes(`key:${normalizedKey}`));
  let deleted = 0;
  for (const item of items) {
    if (await store.deleteItem(item.id, `editable delete key:${normalizedKey}`)) deleted++;
  }
  return { deleted };
}

function assertEditableCollection(collection: string): asserts collection is EditableUserOrgCollection {
  if (!EDITABLE_USER_ORG_COLLECTIONS.includes(collection as EditableUserOrgCollection)) throw new Error(`collection is not user-editable: ${collection}`);
}

function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error('editable memory key is required');
  return normalized.slice(0, 80);
}
