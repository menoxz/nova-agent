import type { ProviderDoctorReport, ProviderProfile, ProviderRuntimeResolution, ResolvedProviderProfile } from './types.js';

export const DEFAULT_PROVIDER_PROFILE_ID = 'openrouter-deepseek-v4-flash';

export const providerProfiles: ProviderProfile[] = [
  {
    id: 'openrouter-deepseek-v4-flash',
    label: 'OpenRouter · DeepSeek V4 Flash',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openmodel/deepseek-v4-flash',
    protocol: 'openai-chat-completions',
    apiKeyEnv: 'LLM_API_KEY',
    notes: 'Default OpenAI-compatible OpenRouter route used by Nova local development.',
  },
  {
    id: 'openmodel-deepseek-v4-flash',
    label: 'OpenModel · DeepSeek V4 Flash',
    provider: 'openmodel',
    baseUrl: 'https://api.openmodel.ai/v1',
    model: 'deepseek-v4-flash',
    protocol: 'anthropic-messages',
    apiKeyEnv: 'LLM_API_KEY',
    notes: 'Anthropic-compatible OpenModel messages endpoint.',
  },
  {
    id: 'openai-gpt-4o-mini',
    label: 'OpenAI · GPT-4o mini',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    protocol: 'openai-chat-completions',
    apiKeyEnv: 'LLM_API_KEY',
  },
  {
    id: 'anthropic-claude-sonnet',
    label: 'Anthropic · Claude Sonnet',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic-messages',
    apiKeyEnv: 'LLM_API_KEY',
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek · Chat',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    protocol: 'openai-chat-completions',
    apiKeyEnv: 'LLM_API_KEY',
  },
];

export function listProviderProfiles(): ProviderProfile[] {
  return [...providerProfiles];
}

export function getProviderProfile(id: string | undefined): ProviderProfile | undefined {
  if (!id) return undefined;
  return providerProfiles.find((profile) => profile.id === id);
}

export function parseProviderFallback(value: string | undefined): string[] {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

export function resolveProviderRuntime(input: {
  cliProfileId?: string;
  cliFallback?: string;
  env?: NodeJS.ProcessEnv;
  project?: { llm?: { providerProfile?: string; fallbackProfiles?: string[]; provider?: string; baseUrl?: string; model?: string } };
}): ProviderRuntimeResolution {
  const env = input.env ?? process.env;
  const envProfileId = env.NOVA_PROVIDER_PROFILE || env.NOVA_LLM_PROVIDER_PROFILE;
  const profileId = input.cliProfileId || envProfileId || input.project?.llm?.providerProfile || DEFAULT_PROVIDER_PROFILE_ID;
  const selectedBy = input.cliProfileId ? 'cli' : envProfileId ? 'env' : input.project?.llm?.providerProfile ? 'config' : 'default';
  const knownProfile = getProviderProfile(profileId);
  const defaultProfile = getProviderProfile(DEFAULT_PROVIDER_PROFILE_ID)!;
  const profile = knownProfile ?? defaultProfile;
  const fieldOverridesAllowed = selectedBy !== 'cli';
  const provider = fieldOverridesAllowed ? env.LLM_PROVIDER || input.project?.llm?.provider || profile.provider : profile.provider;
  const baseUrl = fieldOverridesAllowed ? env.LLM_BASE_URL || input.project?.llm?.baseUrl || profile.baseUrl : profile.baseUrl;
  const model = fieldOverridesAllowed ? env.LLM_MODEL || input.project?.llm?.model || profile.model : profile.model;
  const primary: ResolvedProviderProfile = {
    ...profile,
    id: knownProfile ? profileId : profile.id,
    provider,
    baseUrl,
    model,
    source: knownProfile && provider === profile.provider && baseUrl === profile.baseUrl && model === profile.model ? 'builtin-profile' : 'explicit-config',
  };

  const fallbackProfileIds = input.cliFallback !== undefined
    ? parseProviderFallback(input.cliFallback)
    : env.NOVA_PROVIDER_FALLBACK !== undefined
      ? parseProviderFallback(env.NOVA_PROVIDER_FALLBACK)
      : env.NOVA_LLM_FALLBACK !== undefined
        ? parseProviderFallback(env.NOVA_LLM_FALLBACK)
        : input.project?.llm?.fallbackProfiles ?? [];
  const fallbackProfiles = fallbackProfileIds.flatMap((id) => {
    const fallback = getProviderProfile(id);
    return fallback ? [{ ...fallback, source: 'builtin-profile' as const }] : [];
  });

  const errors = validateResolved(primary);
  if (!knownProfile) errors.push(`Unknown provider profile: ${profileId}`);
  for (const id of fallbackProfileIds) if (!getProviderProfile(id)) errors.push(`Unknown fallback provider profile: ${id}`);
  const warnings: string[] = [];
  if (fallbackProfileIds.includes(primary.id)) warnings.push(`Fallback profile list repeats primary profile: ${primary.id}`);
  if (fallbackProfileIds.length) warnings.push('Provider fallback is configured explicitly. Nova V1 will never switch providers silently; fallback attempts must be surfaced by the caller/runtime.');

  return {
    profileId,
    profileKnown: knownProfile !== undefined,
    selectedBy,
    primary,
    fallbackProfileIds,
    fallbackProfiles,
    fallbackEnabled: fallbackProfileIds.length > 0,
    warnings,
    errors,
  };
}

export function providerDoctor(input: ProviderRuntimeResolution, env: NodeJS.ProcessEnv = process.env): ProviderDoctorReport {
  return {
    ok: input.errors.length === 0,
    primary: {
      id: input.primary.id,
      provider: input.primary.provider,
      baseUrl: safeDisplayUrl(input.primary.baseUrl),
      model: input.primary.model,
      protocol: input.primary.protocol,
      profileKnown: input.profileKnown,
      selectedBy: input.selectedBy,
    },
    apiKey: {
      env: 'LLM_API_KEY',
      status: env.LLM_API_KEY ? 'present' : 'missing',
    },
    fallback: {
      enabled: input.fallbackEnabled,
      explicitOnly: true,
      automaticSilentFallback: false,
      profileIds: input.fallbackProfileIds,
      profiles: input.fallbackProfiles.map((profile) => ({ id: profile.id, provider: profile.provider, baseUrl: safeDisplayUrl(profile.baseUrl), model: profile.model, protocol: profile.protocol })),
    },
    warnings: input.warnings,
    errors: input.errors,
  };
}

function validateResolved(profile: ResolvedProviderProfile): string[] {
  const errors: string[] = [];
  if (!profile.provider.trim()) errors.push('provider is required');
  if (!profile.model.trim()) errors.push('model is required');
  try {
    new URL(profile.baseUrl);
  } catch {
    errors.push(`baseUrl must be a valid URL: ${safeDisplayUrl(profile.baseUrl)}`);
  }
  if (!['anthropic', 'openmodel', 'openai', 'openrouter', 'deepseek'].includes(profile.provider)) errors.push(`provider adapter is not explicitly supported: ${profile.provider}`);
  return errors;
}

function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    return url.toString();
  } catch {
    return value.replace(/\/\/[^/@\s]+@/, '//[REDACTED]@');
  }
}
