import type { AgentConfig } from '../types.js';
import type { ResolvedAgentProfile } from '../profiles/types.js';
import type { MemoryProfileRuntime, MemoryRuntimeConfig } from './types.js';

export function memoryRuntimeFromProfile(profile: ResolvedAgentProfile): MemoryProfileRuntime {
  return {
    id: profile.identity.id,
    version: profile.identity.version,
    hash: profile.hash,
    source: profile.source,
    mode: profile.trace.mode,
    policyProfileId: profile.trace.policyProfileId ?? profile.policy.profileId,
    memory: profile.memory,
  };
}

export function memoryConfigFromAgentConfig(config: AgentConfig): MemoryRuntimeConfig {
  return {
    ...config.memory,
    profile: config.memory?.profile ?? (config.profile ? {
      id: config.profile.id,
      version: config.profile.version,
      hash: config.profile.hash,
      source: config.profile.source,
      mode: config.profile.mode,
      policyProfileId: config.profile.policyProfileId,
      memory: config.memory?.profile?.memory,
    } : undefined),
    policyProfileId: config.memory?.policyProfileId ?? config.policy?.profileId ?? config.profile?.policyProfileId,
    actor: config.memory?.actor ?? config.policy?.actor,
    delegation: config.memory?.delegation ?? config.policy?.delegation,
    approvalProvided: config.memory?.approvalProvided ?? config.policy?.approvalProvided,
  };
}
