import type { CapabilityCategory, ToolRiskLevel } from '../policy/types.js';

export const PROFILE_SCHEMA_VERSION = 1 as const;

export type AgentProfileSchemaVersion = typeof PROFILE_SCHEMA_VERSION;
export type AgentProfileSource = 'builtin' | 'custom' | 'imported';
export type AgentProfileRuntimeMode = 'root' | 'subagent' | 'tool_worker';
export type AgentProfileOutputFormat = 'text' | 'markdown' | 'json' | 'structured';
export type AgentProfileMemoryScope = 'none' | 'session' | 'project' | 'workspace' | 'future';
export type AgentProfileModelProvider = 'deepseek' | 'openai' | 'openrouter' | 'anthropic' | 'mock' | string;

export interface AgentProfileIdentity {
  id: string;
  version: string;
  name: string;
  description: string;
  objective: string;
  tags: string[];
}

export interface AgentProfileModelOverrideRules {
  allowEnvironmentOverride: boolean;
  allowRuntimeOverride: boolean;
  lockedFields?: Array<'provider' | 'modelId' | 'temperature' | 'maxTokens'>;
}

export interface AgentProfileModelFallback {
  provider: AgentProfileModelProvider;
  modelId: string;
}

export interface AgentProfileModel {
  provider: AgentProfileModelProvider;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  fallback?: AgentProfileModelFallback[];
  overrideRules: AgentProfileModelOverrideRules;
}

export interface AgentProfilePrompts {
  system: string;
  developer?: string;
  constraints: string[];
  style: string[];
}

export interface AgentProfileRuntime {
  maxSteps: number;
  stopConditions: string[];
  defaultMode: AgentProfileRuntimeMode;
}

export interface AgentProfileTools {
  allowed: string[];
  denied: string[];
  presets: string[];
}

export interface AgentProfilePolicy {
  profileId: string;
  capabilities: CapabilityCategory[];
  approvalRequiredFor: Array<CapabilityCategory | ToolRiskLevel | string>;
}

export interface AgentProfileMemory {
  scope: AgentProfileMemoryScope;
  readCollections: string[];
  writeCollections: string[];
  retention: {
    ttlDays?: number;
    maxItems?: number;
    strategy: 'none' | 'session' | 'summarize' | 'archive' | 'future';
  };
}

export interface AgentProfileEval {
  suiteIds: string[];
  requiredGates: string[];
  baselineHooks: string[];
}

export interface AgentProfileOutput {
  format: AgentProfileOutputFormat;
  schema?: Record<string, unknown>;
  requiredSections: string[];
}

export interface AgentProfileSubagent {
  compatibleRoles: string[];
  canRunAsRoot: boolean;
  canRunAsSubagent: boolean;
  canRunAsToolWorker: boolean;
  verificationIndependence: boolean;
}

export interface AgentProfileTrace {
  profileId: string;
  profileVersion: string;
  profileHash: string;
  source: AgentProfileSource;
  mode: AgentProfileRuntimeMode;
  policyProfileId?: string;
}

export interface AgentProfile {
  schemaVersion: AgentProfileSchemaVersion;
  identity: AgentProfileIdentity;
  model: AgentProfileModel;
  prompts: AgentProfilePrompts;
  runtime: AgentProfileRuntime;
  tools: AgentProfileTools;
  policy: AgentProfilePolicy;
  memory: AgentProfileMemory;
  eval: AgentProfileEval;
  output: AgentProfileOutput;
  subagent: AgentProfileSubagent;
  trace?: Partial<AgentProfileTrace>;
}

export interface AgentProfileMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  objective: string;
  tags: string[];
  source: AgentProfileSource;
  hash: string;
  policyProfileId: string;
  defaultMode: AgentProfileRuntimeMode;
  compatibleRoles: string[];
}

export interface ResolvedAgentProfile extends AgentProfile {
  source: AgentProfileSource;
  hash: string;
  trace: AgentProfileTrace;
}

export interface ProfileResolutionOptions {
  profileId?: string;
  mode?: AgentProfileRuntimeMode;
  projectRoot?: string;
  includeCustom?: boolean;
}

export interface ProfileValidationResult {
  ok: boolean;
  errors: string[];
}
