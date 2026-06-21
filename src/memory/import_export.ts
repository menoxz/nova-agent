import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { appendMemoryAudit } from './audit.js';
import { assertMemoryPath, exportPath, importPath, memoryRoot, sha256, writeJsonAtomic } from './paths.js';
import { parseMemoryItem } from './schema.js';
import { MemoryStore } from './store.js';
import { collectionsForRead, evaluateMemoryPolicy, isCollectionExplicitlyAllowedForRead, isSensitiveMemoryCollection } from './policy.js';
import { containsRawArtifactReference, containsSecretLike } from './redaction.js';
import { writeMemory } from './writer.js';
import type { MemoryExportBundle, MemoryItem, MemoryRuntimeConfig } from './types.js';

const MAX_IMPORT_ITEMS = 500;
const MAX_IMPORT_BYTES = 5_000_000;

export async function exportMemoryBundle(filename: string, config: MemoryRuntimeConfig = {}): Promise<{ path: string; bundle: MemoryExportBundle }> {
  assertSafeBundleFilename(filename);
  const store = new MemoryStore(config);
  const decision = evaluateMemoryPolicy(config, { action: 'export', readOnly: false, contentPreview: JSON.stringify({ filename }).slice(0, 4_000) });
  if (decision.decision !== 'allow') {
    await appendMemoryAudit(store.root, { action: 'export', decision: decision.decision, reason: decision.reason, counts: { exported: 0 } });
    throw new Error(decision.safeMessage);
  }
  const allowedCollections = collectionsForRead({ ...config, query: '', action: 'export' });
  const excluded = ['audit logs', 'archive', 'quarantine', 'deleted items', 'non-active lifecycle'];
  const items = (await store.listItems()).filter((item) => {
    if (item.lifecycle.status !== 'active') return false;
    if (allowedCollections !== undefined && !allowedCollections.includes(item.collection)) return false;
    if (isSensitiveMemoryCollection(item.collection) && !isCollectionExplicitlyAllowedForRead(item.collection, { ...config, query: '', action: 'export' })) return false;
    return true;
  });
  const bundle: MemoryExportBundle = { schemaVersion: 1, bundleId: `mb_${randomUUID()}`, createdAt: new Date().toISOString(), items, manifest: { itemCount: items.length, excluded, bundleHash: '' } };
  bundle.manifest.bundleHash = sha256(JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, bundleHash: '' } }));
  const path = exportPath(store.root, filename.endsWith('.json') ? filename : `${filename}.json`);
  await writeJsonAtomic(path, bundle);
  await appendMemoryAudit(store.root, { action: 'export', decision: decision.decision, counts: { exported: items.length } });
  return { path, bundle };
}

export async function importMemoryBundle(filename: string, config: MemoryRuntimeConfig = {}): Promise<{ accepted: number; rejected: number; quarantinedPath: string }> {
  assertSafeBundleFilename(filename);
  const root = memoryRoot(config.projectRoot, config.memoryRoot);
  const path = assertMemoryPath(importPath(root, filename), root, 'Memory import path');
  const raw = await readFile(path, 'utf-8');
  if (Buffer.byteLength(raw, 'utf-8') > MAX_IMPORT_BYTES) throw new Error('Memory import bundle exceeds size limit');
  const bundle = JSON.parse(raw) as MemoryExportBundle;
  const validation = validateImportBundle(bundle);
  const manifestPath = importPath(root, `${filename}.manifest.json`);
  await writeJsonAtomic(manifestPath, { schemaVersion: 1, state: validation.ok ? 'quarantined' : 'rejected', sourcePath: path, bundleId: bundle.bundleId, itemCount: bundle.items?.length ?? 0, bundleHash: bundle.manifest?.bundleHash, errors: validation.errors, createdAt: new Date().toISOString() });
  if (!validation.ok) throw new Error(`Memory import bundle validation failed: ${validation.errors.join('; ')}`);

  const importDecision = evaluateMemoryPolicy(config, { action: 'import', readOnly: false, contentPreview: JSON.stringify({ filename, itemCount: bundle.items.length }).slice(0, 4_000) });
  if (importDecision.decision !== 'allow') {
    await appendMemoryAudit(root, { action: 'import', decision: importDecision.decision, reason: importDecision.reason, counts: { accepted: 0, rejected: bundle.items.length } });
    await writeJsonAtomic(manifestPath, { schemaVersion: 1, state: 'needs_approval', sourcePath: path, bundleId: bundle.bundleId, itemCount: bundle.items.length, bundleHash: bundle.manifest.bundleHash, errors: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), decision: importDecision.decision, reason: importDecision.reason });
    return { accepted: 0, rejected: bundle.items.length, quarantinedPath: manifestPath };
  }

  let accepted = 0;
  let rejected = 0;
  for (const item of bundle.items) {
    const result = await writeMemory({ type: item.type, collection: item.collection, scope: item.scope, content: item.content, source: { ...item.source, kind: 'import' }, quality: item.quality, lifecycle: { ttlDays: item.lifecycle.ttlDays } }, config);
    if (result.status === 'persisted' || result.status === 'duplicate') accepted += 1;
    else rejected += 1;
  }
  const state = rejected === 0 ? 'activated' : accepted > 0 ? 'partially_activated' : 'rejected';
  await writeJsonAtomic(manifestPath, { schemaVersion: 1, state, sourcePath: path, bundleId: bundle.bundleId, itemCount: bundle.items.length, bundleHash: bundle.manifest.bundleHash, errors: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), accepted, rejected });
  await appendMemoryAudit(root, { action: 'import', decision: importDecision.decision, counts: { accepted, rejected } });
  return { accepted, rejected, quarantinedPath: manifestPath };
}

function validateImportBundle(bundle: MemoryExportBundle): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (bundle.schemaVersion !== 1) errors.push('unsupported schemaVersion');
  if (!bundle.bundleId || !bundle.bundleId.startsWith('mb_')) errors.push('invalid bundleId');
  if (!Array.isArray(bundle.items)) errors.push('items must be an array');
  if (bundle.items?.length > MAX_IMPORT_ITEMS) errors.push('too many items');
  if (!bundle.manifest || typeof bundle.manifest.bundleHash !== 'string') errors.push('missing bundle hash');
  if (bundle.items && bundle.manifest?.itemCount !== bundle.items.length) errors.push('manifest itemCount mismatch');
  const expected = sha256(JSON.stringify({ ...bundle, manifest: { ...bundle.manifest, bundleHash: '' } }));
  if (bundle.manifest?.bundleHash !== expected) errors.push('bundle hash mismatch');
  for (const [index, item] of (bundle.items ?? []).entries()) {
    const parsed = parseMemoryItem(item);
    if (!parsed.success) {
      errors.push(`item ${index} schema invalid`);
      continue;
    }
    if ((item as MemoryItem).lifecycle.status !== 'active') errors.push(`item ${index} is not active`);
    const importContent = { content: item.content, source: { createdFrom: item.source.createdFrom, reference: item.source.reference } };
    if (containsRawArtifactReference(importContent)) errors.push(`item ${index} contains raw artifact reference`);
    if (containsSecretLike(importContent)) errors.push(`item ${index} contains secret-like content`);
  }
  return { ok: errors.length === 0, errors };
}

function assertSafeBundleFilename(filename: string): void {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    throw new Error('Memory import/export filename must be a safe relative filename without traversal');
  }
}
