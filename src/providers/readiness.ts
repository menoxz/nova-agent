import { listProviderDirectory, providerDirectorySummary } from './directory.js';
import { listProviderProfiles } from './profiles.js';
import type { ProviderDirectoryCategory, ProviderProtocol } from './types.js';

export interface ProviderReadinessReport {
  schemaVersion: 1;
  name: 'provider-live-smoke-readiness-v1';
  mode: 'offline-static';
  safety: {
    offlineOnly: true;
    readsEnv: false;
    readsSecrets: false;
    readsRawNovaArtifacts: false;
    invokesProviders: false;
    usesNetwork: false;
    startsDaemonOrAutonomy: false;
  };
  inventory: {
    profileCount: number;
    directoryCount: number;
    directoryCategories: Record<ProviderDirectoryCategory, number>;
    runtimeSupportedDirectoryCount: number;
    runtimeExecutableDirectoryCount: number;
    profileProtocols: Record<ProviderProtocol, number>;
    providerAdapters: string[];
  };
  gates: Array<{ id: string; status: 'ready' | 'blocked'; evidence: string }>;
  futureLiveAuthorization: {
    required: true;
    criteria: string[];
  };
  outOfScope: string[];
}

function emptyProtocolCounts(): Record<ProviderProtocol, number> {
  return {
    'anthropic-messages': 0,
    'openai-chat-completions': 0,
  };
}

export function buildProviderReadinessReport(): ProviderReadinessReport {
  const profiles = listProviderProfiles();
  const directory = listProviderDirectory();
  const protocolCounts = profiles.reduce<Record<ProviderProtocol, number>>((acc, profile) => {
    acc[profile.protocol] += 1;
    return acc;
  }, emptyProtocolCounts());
  const providerAdapters = Array.from(new Set(profiles.map((profile) => profile.provider))).sort();

  return {
    schemaVersion: 1,
    name: 'provider-live-smoke-readiness-v1',
    mode: 'offline-static',
    safety: {
      offlineOnly: true,
      readsEnv: false,
      readsSecrets: false,
      readsRawNovaArtifacts: false,
      invokesProviders: false,
      usesNetwork: false,
      startsDaemonOrAutonomy: false,
    },
    inventory: {
      profileCount: profiles.length,
      directoryCount: directory.length,
      directoryCategories: providerDirectorySummary(),
      runtimeSupportedDirectoryCount: directory.filter((entry) => entry.category === 'runtime-supported').length,
      runtimeExecutableDirectoryCount: directory.filter((entry) => entry.runtimeExecutable).length,
      profileProtocols: protocolCounts,
      providerAdapters,
    },
    gates: [
      { id: 'metadata-only', status: 'ready', evidence: 'provider profiles and provider directory are static built-in metadata' },
      { id: 'synthetic-adapter-errors', status: 'ready', evidence: 'llm:smoke covers synthetic robustness/error classification without provider calls' },
      { id: 'redaction-secret-handling', status: 'ready', evidence: 'providers doctor reports key presence only; security matrix blocks secrets/raw artifacts' },
      { id: 'future-live-smoke', status: 'blocked', evidence: 'requires separate explicit operator authorization before any provider/LLM call' },
    ],
    futureLiveAuthorization: {
      required: true,
      criteria: [
        'offline readiness commands pass in the same working tree',
        'operator names provider profile, model, credential source, budget, prompt, and expected evidence',
        'tool execution remains disabled unless separately allowlisted',
        'abort criteria cover auth, rate limit, endpoint mismatch, network failure, tool call, and secret exposure',
      ],
    },
    outOfScope: [
      'live provider/LLM/network calls',
      '.env, secrets, credentials, prompts, raw .nova traces/evals/reports reads or edits',
      'tools live, daemon/autonomy, publish/tag/push/PR',
      'major provider/LLM architecture refactor',
    ],
  };
}
