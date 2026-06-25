import type { ActorContext, DelegationContext, PolicyDecision } from '../policy/types.js';
import type { AgentProfileMemory, AgentProfileRuntimeMode } from '../profiles/types.js';

export const MEMORY_SCHEMA_VERSION = 1 as const;
export type MemorySchemaVersion = typeof MEMORY_SCHEMA_VERSION;

export type MemoryItemType = 'semantic' | 'episodic' | 'procedural' | 'profile' | 'decision' | 'finding';
export type MemoryScopeKind = 'project' | 'workspace' | 'profile' | 'session' | 'user' | 'subagent' | 'capability';
export type MemorySourceKind = 'user' | 'agent' | 'subagent' | 'eval' | 'trace_summary' | 'import' | 'manual';
export type MemoryLifecycleStatus = 'active' | 'stale' | 'archived' | 'deleted' | 'quarantined';
export type MemoryAction = 'read' | 'propose' | 'write' | 'archive' | 'delete' | 'import' | 'export';

export interface MemoryScope {
  kind: MemoryScopeKind;
  projectId?: string;
  workspaceId?: string;
  profileId?: string;
  sessionId?: string;
  userId?: string;
  subagentRole?: string;
  capability?: string;
}

export interface MemoryContent {
  title: string;
  summary: string;
  body?: string;
  tags: string[];
}

export interface MemorySource {
  kind: MemorySourceKind;
  actorId?: string;
  profileId?: string;
  profileVersion?: string;
  profileHash?: string;
  createdFrom?: string;
  reference?: string;
}

export interface MemoryQuality {
  confidence: number;
  importance: number;
  lastVerifiedAt?: string;
  staleAfter?: string;
}

export interface MemoryLifecycle {
  status: MemoryLifecycleStatus;
  ttlDays?: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
}

export interface MemoryIntegrity {
  contentHash: string;
  fingerprint: string;
  schemaHash: string;
}

export interface MemorySecurity {
  redacted: boolean;
  secretScan: 'passed' | 'redacted' | 'rejected';
  rawArtifactRejected: boolean;
  untrusted: boolean;
  injectionRisk?: 'none' | 'low' | 'medium' | 'high';
}

export interface MemoryItem {
  schemaVersion: MemorySchemaVersion;
  id: string;
  type: MemoryItemType;
  collection: string;
  scope: MemoryScope;
  content: MemoryContent;
  source: MemorySource;
  quality: MemoryQuality;
  lifecycle: MemoryLifecycle;
  integrity: MemoryIntegrity;
  security: MemorySecurity;
}

export interface MemoryProposal {
  type: MemoryItemType;
  collection: string;
  scope: MemoryScope;
  content: MemoryContent;
  source: MemorySource;
  quality?: Partial<MemoryQuality>;
  lifecycle?: Partial<Pick<MemoryLifecycle, 'ttlDays'>>;
}

export interface MemoryProfileRuntime {
  id: string;
  version: string;
  hash: string;
  source: 'builtin' | 'custom' | 'imported';
  mode: AgentProfileRuntimeMode;
  policyProfileId?: string;
  memory?: AgentProfileMemory;
}

export interface MemoryRuntimeConfig {
  enabled?: boolean;
  projectRoot?: string;
  memoryRoot?: string;
  tokenBudget?: number;
  profile?: MemoryProfileRuntime;
  policyProfileId?: string;
  actor?: ActorContext;
  delegation?: DelegationContext;
  approvalProvided?: boolean;
  sessionId?: string;
  defaultScope?: MemoryScopeKind;
  readCollections?: string[];
  writeCollections?: string[];
}

export interface MemoryQueryContext extends MemoryRuntimeConfig {
  query: string;
  action?: MemoryAction;
  requestedCollections?: string[];
  requestedScopes?: MemoryScopeKind[];
  capability?: string;
  includeStale?: boolean;
}

export interface MemoryCard {
  id: string;
  type: MemoryItemType;
  collection: string;
  scope: MemoryScope;
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
  importance: number;
  stale: boolean;
  source: MemorySourceKind;
  score: number;
}

export interface MemoryRetrievalResult {
  cards: MemoryCard[];
  contextBlock: string;
  omitted: Record<string, number>;
  policyDecision?: Pick<PolicyDecision, 'decision' | 'ruleId' | 'reason'>;
  indexHash?: string;
  summary: MemoryTraceSummary;
}

export interface MemoryWriteResult {
  status: 'persisted' | 'duplicate' | 'rejected' | 'needs_approval';
  item?: MemoryItem;
  existingId?: string;
  reason?: string;
  policyDecision?: Pick<PolicyDecision, 'decision' | 'ruleId' | 'reason'>;
}

export interface MemoryIndexEntry {
  id: string;
  type: MemoryItemType;
  collection: string;
  scope: MemoryScope;
  title: string;
  summaryPreview: string;
  tags: string[];
  confidence: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
  staleAfter?: string;
  lastVerifiedAt?: string;
  status: MemoryLifecycleStatus;
  contentHash: string;
  fingerprint: string;
  sourceKind: MemorySourceKind;
  redacted: boolean;
  injectionRisk?: MemorySecurity['injectionRisk'];
}

export interface MemoryIndex {
  schemaVersion: MemorySchemaVersion;
  generatedAt: string;
  storeVersion: string;
  items: MemoryIndexEntry[];
  collections: Array<{ id: string; count: number; lastUpdatedAt?: string }>;
  migrations: string[];
  integrity: { itemCount: number; indexHash: string };
}

export interface MemoryRagChunk {
  id: string;
  itemId: string;
  collection: string;
  scope: MemoryScope;
  type: MemoryItemType;
  title: string;
  text: string;
  tags: string[];
  tokenCount: number;
  termFrequency: Record<string, number>;
  contentHash: string;
  updatedAt: string;
}

export interface MemoryRagIndex {
  schemaVersion: MemorySchemaVersion;
  generatedAt: string;
  algorithm: 'local-bm25-lite';
  chunkCount: number;
  documentFrequency: Record<string, number>;
  chunks: MemoryRagChunk[];
  integrity: { ragIndexHash: string };
}

export interface MemoryRagHit {
  itemId: string;
  chunkId: string;
  score: number;
  title: string;
  snippet: string;
  matchedTerms: string[];
}

export interface MemoryAuditEvent {
  schemaVersion: MemorySchemaVersion;
  id: string;
  timestamp: string;
  action: MemoryAction | 'reject' | 'persist' | 'retrieve' | 'rebuild-index' | 'doctor' | 'consolidate';
  itemId?: string;
  fingerprint?: string;
  actorId?: string;
  profileId?: string;
  collection?: string;
  scopeKind?: MemoryScopeKind;
  decision?: string;
  reason?: string;
  counts?: Record<string, number>;
}

export interface MemoryTraceSummary {
  retrievedIds: string[];
  retrievedCount: number;
  retrievedChars: number;
  proposedCount?: number;
  writtenIds?: string[];
}

export interface MemoryDoctorReport {
  checked: number;
  corrupt: number;
  archived: number;
  rebuiltIndexHash?: string;
  skipped: Array<{ path: string; reason: string }>;
}

export interface MemoryExportBundle {
  schemaVersion: MemorySchemaVersion;
  bundleId: string;
  createdAt: string;
  items: MemoryItem[];
  manifest: { itemCount: number; excluded: string[]; bundleHash: string };
}
