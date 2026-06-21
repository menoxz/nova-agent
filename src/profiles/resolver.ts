import type { AgentConfig } from '../types.js';
import { hashProfile } from './hash.js';
import { assertValidProfile } from './validate.js';
import { builtInProfiles, getBuiltInProfile } from './defaults.js';
import type { AgentProfile, AgentProfileSource, ProfileResolutionOptions, ResolvedAgentProfile } from './types.js';

export const DEFAULT_PROFILE_ID = 'nova.general';

export function resolveProfileSync(options: ProfileResolutionOptions = {}, customProfiles: AgentProfile[] = []): ResolvedAgentProfile {
  const id = options.profileId || process.env.NOVA_PROFILE || DEFAULT_PROFILE_ID;
  const candidate = customProfiles.find((profile) => profile.identity.id === id) ?? getBuiltInProfile(id);
  if (!candidate) throw new Error(`Unknown Nova agent profile: ${id}`);
  const source: AgentProfileSource = builtInProfiles.some((profile) => profile.identity.id === candidate.identity.id) ? 'builtin' : 'custom';
  const profile = assertValidProfile(candidate);
  const hash = hashProfile(profile);
  const mode = options.mode ?? profile.runtime.defaultMode;
  return {
    ...profile,
    source,
    hash,
    trace: { profileId: profile.identity.id, profileVersion: profile.identity.version, profileHash: hash, source, mode },
  };
}

export function profilePromptBlock(profile: ResolvedAgentProfile): string {
  return [
    `## Agent Profile: ${profile.identity.name}`,
    `Profile ID: ${profile.identity.id}@${profile.identity.version}`,
    `Objective: ${profile.identity.objective}`,
    profile.prompts.system,
    profile.prompts.developer ? `Developer guidance: ${profile.prompts.developer}` : '',
    profile.prompts.constraints.length ? `Constraints:\n${profile.prompts.constraints.map((item) => `- ${item}`).join('\n')}` : '',
    profile.prompts.style.length ? `Style:\n${profile.prompts.style.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function applyProfileToConfig(config: AgentConfig, profile: ResolvedAgentProfile): AgentConfig {
  const allowEnv = profile.model.overrideRules.allowEnvironmentOverride;
  const locked = new Set(profile.model.overrideRules.lockedFields ?? []);
  const envProvider = allowEnv ? process.env.LLM_PROVIDER : undefined;
  const envModel = allowEnv ? process.env.LLM_MODEL : undefined;
  const envMaxTokens = allowEnv && process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined;
  const effectivePolicyProfileId = config.policy?.allowProfilePolicyOverride ? (config.policy.profileId ?? profile.policy.profileId) : profile.policy.profileId;
  return {
    ...config,
    llm: {
      ...config.llm,
      provider: !locked.has('provider') && envProvider ? envProvider : profile.model.provider,
      model: !locked.has('modelId') && envModel ? envModel : profile.model.modelId,
      maxTokens: !locked.has('maxTokens') && envMaxTokens ? envMaxTokens : profile.model.maxTokens,
    },
    systemPrompt: [profilePromptBlock(profile), config.systemPrompt].filter(Boolean).join('\n\n'),
    maxSteps: profile.runtime.maxSteps,
    policy: { ...config.policy, profileId: effectivePolicyProfileId },
    toolConstraints: { allowed: [...profile.tools.allowed], denied: [...profile.tools.denied], presets: [...profile.tools.presets] },
    profile: { id: profile.identity.id, version: profile.identity.version, name: profile.identity.name, hash: profile.hash, source: profile.source, mode: profile.trace.mode, policyProfileId: effectivePolicyProfileId },
    trace: { ...config.trace, profile: { ...profile.trace, policyProfileId: effectivePolicyProfileId } },
  };
}

export function resolveConfigProfile(config: AgentConfig, options: ProfileResolutionOptions = {}): AgentConfig {
  return applyProfileToConfig(config, resolveProfileSync(options));
}
