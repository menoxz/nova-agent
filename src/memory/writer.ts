import { appendMemoryAudit } from './audit.js';
import { evaluateMemoryPolicy, collectionsForWrite, isCollectionExplicitlyAllowedForWrite, isSensitiveMemoryCollection } from './policy.js';
import { containsRawArtifactReference, containsSecretLike, injectionRisk, redactMemoryContent } from './redaction.js';
import { createMemoryItem, MemoryStore } from './store.js';
import type { MemoryItem, MemoryProposal, MemoryRuntimeConfig, MemoryWriteResult } from './types.js';

export function proposeMemory(proposal: MemoryProposal): MemoryProposal {
  return structuredClone(proposal);
}

export async function writeMemory(proposal: MemoryProposal, config: MemoryRuntimeConfig = {}): Promise<MemoryWriteResult> {
  const store = new MemoryStore(config);
  await store.init();
  const preview = JSON.stringify({ collection: proposal.collection, scope: proposal.scope, content: proposal.content }).slice(0, 4_000);

  if (containsRawArtifactReference(proposal)) {
    await appendMemoryAudit(store.root, auditReject('raw artifact reference rejected', proposal));
    return { status: 'rejected', reason: 'raw .nova/.env/.git/node_modules artifacts are not accepted in memory' };
  }
  if (containsSecretLike(proposal)) {
    await appendMemoryAudit(store.root, auditReject('secret-like content rejected', proposal));
    return { status: 'rejected', reason: 'secret-like content rejected' };
  }

  const writeCollections = collectionsForWrite(config);
  if (writeCollections !== undefined && !writeCollections.includes(proposal.collection)) {
    await appendMemoryAudit(store.root, auditReject('collection not writable by profile', proposal));
    return { status: 'rejected', reason: `collection not writable by active profile: ${proposal.collection}` };
  }
  if (isSensitiveMemoryCollection(proposal.collection) && !isCollectionExplicitlyAllowedForWrite(proposal.collection, config)) {
    await appendMemoryAudit(store.root, auditReject('sensitive collection requires explicit allow-list entry', proposal));
    return { status: 'rejected', reason: `sensitive collection requires explicit allow-list entry: ${proposal.collection}` };
  }

  const decision = evaluateMemoryPolicy(config, { action: 'write', collection: proposal.collection, scope: proposal.scope, readOnly: false, contentPreview: preview });
  if (decision.decision !== 'allow') {
    await appendMemoryAudit(store.root, { ...auditReject(decision.reason, proposal), decision: decision.decision });
    return { status: decision.decision === 'ask' ? 'needs_approval' : 'rejected', reason: decision.safeMessage, policyDecision: decision };
  }

  const now = new Date().toISOString();
  const redacted = redactMemoryContent(proposal.content);
  const ttlDays = proposal.lifecycle?.ttlDays ?? config.profile?.memory?.retention.ttlDays ?? defaultTtlDays(proposal.type);
  const item = createMemoryItem({
    type: proposal.type,
    collection: proposal.collection,
    scope: proposal.scope,
    content: redacted.content,
    source: enrichSource(proposal, config),
    quality: {
      confidence: clamp(proposal.quality?.confidence ?? 0.7),
      importance: clamp(proposal.quality?.importance ?? 0.5),
      lastVerifiedAt: proposal.quality?.lastVerifiedAt,
      staleAfter: proposal.quality?.staleAfter ?? new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
    },
    lifecycle: { status: 'active', ttlDays, createdAt: now, updatedAt: now, archivedAt: null },
    security: { redacted: redacted.redacted, secretScan: redacted.redacted ? 'redacted' : 'passed', rawArtifactRejected: false, untrusted: true, injectionRisk: injectionRisk(redacted.content) },
  });

  const duplicate = (await store.readIndex()).items.find((entry) => entry.fingerprint === item.integrity.fingerprint);
  if (duplicate) {
    await appendMemoryAudit(store.root, { action: 'propose', itemId: duplicate.id, fingerprint: duplicate.fingerprint, collection: proposal.collection, scopeKind: proposal.scope.kind, decision: 'duplicate' });
    return { status: 'duplicate', existingId: duplicate.id, reason: 'duplicate fingerprint already exists' };
  }

  await store.persistItem(item);
  await appendMemoryAudit(store.root, { action: 'persist', itemId: item.id, fingerprint: item.integrity.fingerprint, actorId: config.actor?.actorId, profileId: config.profile?.id, collection: item.collection, scopeKind: item.scope.kind, decision: decision.decision });
  return { status: 'persisted', item, policyDecision: decision };
}

export async function validateMemoryProposal(proposal: MemoryProposal): Promise<{ ok: boolean; reason?: string }> {
  if (!proposal.content.title.trim() || !proposal.content.summary.trim()) return { ok: false, reason: 'title and summary are required' };
  if (containsRawArtifactReference(proposal)) return { ok: false, reason: 'raw artifact reference rejected' };
  if (containsSecretLike(proposal)) return { ok: false, reason: 'secret-like content rejected' };
  return { ok: true };
}

function enrichSource(proposal: MemoryProposal, config: MemoryRuntimeConfig): MemoryItem['source'] {
  return {
    ...proposal.source,
    actorId: proposal.source.actorId ?? config.actor?.actorId,
    profileId: proposal.source.profileId ?? config.profile?.id,
    profileVersion: proposal.source.profileVersion ?? config.profile?.version,
    profileHash: proposal.source.profileHash ?? config.profile?.hash,
  };
}

function auditReject(reason: string, proposal: MemoryProposal) {
  return { action: 'reject' as const, collection: proposal.collection, scopeKind: proposal.scope.kind, reason };
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

function defaultTtlDays(type: MemoryProposal['type']): number {
  if (type === 'episodic') return 30;
  if (type === 'finding') return 90;
  if (type === 'profile') return 365;
  return 180;
}
