import { evaluatePolicy } from '../policy/engine.js';
import { getPolicyProfile } from '../policy/profiles.js';
import type { PolicyDecision } from '../policy/types.js';
import type { MemoryAction, MemoryQueryContext, MemoryRuntimeConfig, MemoryScope } from './types.js';

const SENSITIVE_COLLECTIONS = new Set([
  'user_profile',
  'user_preferences',
  'organization_profile',
  'organization_policies',
  'organization_stack',
  'organization_glossary',
  'organization_constraints',
  'security_findings',
  'secrets',
  'credentials',
  'auth_tokens',
]);

export function defaultMemoryActor(config: MemoryRuntimeConfig) {
  return config.actor ?? { actorId: 'nova-memory', actorType: 'root_agent' as const, sessionId: config.sessionId };
}

export function evaluateMemoryPolicy(config: MemoryRuntimeConfig, input: { action: MemoryAction; scope?: MemoryScope; collection?: string; readOnly?: boolean; contentPreview?: string }): PolicyDecision {
  const profileId = config.policyProfileId ?? config.profile?.policyProfileId ?? 'readonly';
  const profile = getPolicyProfile(profileId);
  const decision = evaluatePolicy({
    actor: defaultMemoryActor(config),
    delegation: config.delegation,
    profileId,
    capability: 'memory',
    action: `memory:${input.action}`,
    readOnly: input.readOnly ?? input.action === 'read',
    contentPreview: input.contentPreview,
    metadata: { collection: input.collection, scope: input.scope?.kind },
  }, { profile });
  if (decision.decision === 'ask' && config.approvalProvided === true) {
    return { decision: 'allow', ruleId: decision.ruleId, reason: `approved request: ${decision.reason}`, safeMessage: 'Nova policy allow: approved memory request' };
  }
  return decision;
}

export function memoryEnabled(config: MemoryRuntimeConfig): boolean {
  if (config.enabled !== true) return false;
  if (config.profile?.memory?.scope === 'none') return false;
  return true;
}

export function collectionsForRead(ctx: MemoryQueryContext): string[] | undefined {
  const configuredCollections = ctx.profile?.memory ? ctx.profile.memory.readCollections : ctx.readCollections;
  return ctx.requestedCollections?.length
    ? ctx.requestedCollections.filter((collection) => configuredCollections === undefined || configuredCollections.includes(collection))
    : configuredCollections;
}

export function collectionsForWrite(config: MemoryRuntimeConfig): string[] | undefined {
  return config.profile?.memory ? config.profile.memory.writeCollections : config.writeCollections;
}

export function isSensitiveMemoryCollection(collection: string): boolean {
  return SENSITIVE_COLLECTIONS.has(collection);
}

export function isCollectionExplicitlyAllowedForRead(collection: string, ctx: MemoryQueryContext): boolean {
  const configuredCollections = ctx.profile?.memory ? ctx.profile.memory.readCollections : ctx.readCollections;
  return Boolean(configuredCollections?.includes(collection));
}

export function isCollectionExplicitlyAllowedForWrite(collection: string, config: MemoryRuntimeConfig): boolean {
  const configuredCollections = ctxCollectionsForWrite(config);
  return Boolean(configuredCollections?.includes(collection));
}

function ctxCollectionsForWrite(config: MemoryRuntimeConfig): string[] | undefined {
  return config.profile?.memory ? config.profile.memory.writeCollections : config.writeCollections;
}
