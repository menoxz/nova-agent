export type ProviderProtocol = 'anthropic-messages' | 'openai-chat-completions';
export type ProviderDirectoryCategory = 'runtime-supported' | 'openai-compatible' | 'anthropic-compatible' | 'planned' | 'gateway-subscription-token-plan' | 'custom-other';

export interface ProviderProfile {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  apiKeyEnv: 'LLM_API_KEY';
  notes?: string;
}

export interface ProviderDirectoryEntry {
  id: string;
  name: string;
  category: ProviderDirectoryCategory;
  runtimeExecutable: boolean;
  profileIds?: string[];
  compatibility?: Array<'openai-chat-completions' | 'anthropic-messages' | 'sdk-required' | 'gateway' | 'local' | 'custom'>;
  notes?: string;
}

export interface ResolvedProviderProfile extends ProviderProfile {
  source: 'builtin-profile' | 'explicit-config';
}

export interface ProviderRuntimeResolution {
  profileId: string;
  profileKnown: boolean;
  selectedBy: 'cli' | 'env' | 'config' | 'default';
  primary: ResolvedProviderProfile;
  fallbackProfileIds: string[];
  fallbackProfiles: ResolvedProviderProfile[];
  fallbackEnabled: boolean;
  warnings: string[];
  errors: string[];
}

export interface ProviderDoctorReport {
  ok: boolean;
  primary: {
    id: string;
    provider: string;
    baseUrl: string;
    model: string;
    protocol: ProviderProtocol;
    profileKnown: boolean;
    selectedBy: ProviderRuntimeResolution['selectedBy'];
  };
  apiKey: {
    env: 'LLM_API_KEY';
    status: 'present' | 'missing';
  };
  fallback: {
    enabled: boolean;
    explicitOnly: true;
    automaticSilentFallback: false;
    profileIds: string[];
    profiles: Array<{ id: string; provider: string; baseUrl: string; model: string; protocol: ProviderProtocol }>;
  };
  warnings: string[];
  errors: string[];
}
