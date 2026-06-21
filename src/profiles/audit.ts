import type { AgentProfileMetadata, ResolvedAgentProfile } from './types.js';

export function sanitizeProfileMetadata(profile: ResolvedAgentProfile): AgentProfileMetadata {
  return {
    id: profile.identity.id,
    version: profile.identity.version,
    name: profile.identity.name,
    description: profile.identity.description,
    objective: profile.identity.objective,
    tags: [...profile.identity.tags],
    source: profile.source,
    hash: profile.hash,
    policyProfileId: profile.policy.profileId,
    defaultMode: profile.runtime.defaultMode,
    compatibleRoles: [...profile.subagent.compatibleRoles],
  };
}
