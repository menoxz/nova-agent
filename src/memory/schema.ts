import { z } from 'zod';
import { MEMORY_SCHEMA_VERSION } from './types.js';

export const memoryScopeSchema = z.object({
  kind: z.enum(['project', 'workspace', 'profile', 'session', 'user', 'subagent', 'capability']),
  projectId: z.string().optional(),
  workspaceId: z.string().optional(),
  profileId: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  subagentRole: z.string().optional(),
  capability: z.string().optional(),
});

export const memoryContentSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2_000),
  body: z.string().max(8_000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
});

export const memorySourceSchema = z.object({
  kind: z.enum(['user', 'agent', 'subagent', 'eval', 'trace_summary', 'import', 'manual']),
  actorId: z.string().optional(),
  profileId: z.string().optional(),
  profileVersion: z.string().optional(),
  profileHash: z.string().optional(),
  createdFrom: z.string().max(200).optional(),
  reference: z.string().max(500).optional(),
});

export const memoryItemSchema = z.object({
  schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
  id: z.string().regex(/^mem_[a-zA-Z0-9_-]+$/),
  type: z.enum(['semantic', 'episodic', 'procedural', 'profile', 'decision', 'finding']),
  collection: z.string().min(1).max(100),
  scope: memoryScopeSchema,
  content: memoryContentSchema,
  source: memorySourceSchema,
  quality: z.object({
    confidence: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
    lastVerifiedAt: z.string().datetime().optional(),
    staleAfter: z.string().datetime().optional(),
  }),
  lifecycle: z.object({
    status: z.enum(['active', 'stale', 'archived', 'deleted', 'quarantined']),
    ttlDays: z.number().int().positive().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable().optional(),
    deletedAt: z.string().datetime().nullable().optional(),
  }),
  integrity: z.object({
    contentHash: z.string().startsWith('sha256:'),
    fingerprint: z.string().startsWith('sha256:'),
    schemaHash: z.string().startsWith('sha256:'),
  }),
  security: z.object({
    redacted: z.boolean(),
    secretScan: z.enum(['passed', 'redacted', 'rejected']),
    rawArtifactRejected: z.boolean(),
    untrusted: z.boolean(),
    injectionRisk: z.enum(['none', 'low', 'medium', 'high']).optional(),
  }),
});

export const memoryIndexSchema = z.object({
  schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  storeVersion: z.string(),
  items: z.array(z.object({
    id: z.string(),
    type: z.enum(['semantic', 'episodic', 'procedural', 'profile', 'decision', 'finding']),
    collection: z.string(),
    scope: memoryScopeSchema,
    title: z.string(),
    summaryPreview: z.string(),
    tags: z.array(z.string()),
    confidence: z.number(),
    importance: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    staleAfter: z.string().optional(),
    lastVerifiedAt: z.string().optional(),
    status: z.enum(['active', 'stale', 'archived', 'deleted', 'quarantined']),
    contentHash: z.string(),
    fingerprint: z.string(),
    sourceKind: z.enum(['user', 'agent', 'subagent', 'eval', 'trace_summary', 'import', 'manual']),
    redacted: z.boolean(),
    injectionRisk: z.enum(['none', 'low', 'medium', 'high']).optional(),
  })),
  collections: z.array(z.object({ id: z.string(), count: z.number(), lastUpdatedAt: z.string().optional() })),
  migrations: z.array(z.string()),
  integrity: z.object({ itemCount: z.number(), indexHash: z.string() }),
});

export function assertValidMemoryItem(value: unknown) {
  return memoryItemSchema.parse(value);
}

export function parseMemoryItem(value: unknown) {
  return memoryItemSchema.safeParse(value);
}

export const MEMORY_SCHEMA_HASH = 'sha256:memory-schema-v1';
