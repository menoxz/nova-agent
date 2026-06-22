/**
 * Nova Agent — Core Types
 */

import type { z } from 'zod';
import type { FlexibleSchema, ToolResultOutput } from '@ai-sdk/provider-utils';
import type { ActorContext, CapabilityCategory, DelegationContext, ToolRiskLevel } from './policy/types.js';
export type { LlmPricingConfig, TokenCostEstimate, TokenUsageMeasurement, ResponseTokenMetrics } from './tokens/types.js';

// ─── LLM Provider ────────────────────────────────────────────────────────────

export type LLMProviderName = 'deepseek' | 'openai' | 'openrouter' | string;

export interface LLMConfig {
  provider: LLMProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerProfile?: string;
  fallbackProfiles?: string[];
  maxTokens?: number;
  pricing?: import('./tokens/types.js').LlmPricingConfig;
  robustness?: import('./llm/robustness.js').LlmRobustnessConfig;
}

// ─── Tool System ─────────────────────────────────────────────────────────────

/**
 * Internal Nova tool definition (before conversion to AI SDK format).
 */
export interface NovaTool {
  name: string;
  description: string;
  inputSchema: FlexibleSchema<any>;
  capability?: CapabilityCategory;
  readOnly?: boolean;
  riskLevel?: ToolRiskLevel;
  execute: (input: any, options?: { toolCallId?: string; actor?: ActorContext; delegation?: DelegationContext }) => Promise<string | ToolResultOutput>;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentConfig {
  llm: LLMConfig;
  systemPrompt: string;
  maxSteps?: number;
  profile?: {
    id: string;
    version: string;
    name: string;
    hash: string;
    source: 'builtin' | 'custom' | 'imported';
    mode: 'root' | 'subagent' | 'tool_worker';
    policyProfileId?: string;
  };
  toolConstraints?: {
    allowed?: string[];
    denied?: string[];
    presets?: string[];
  };
  trace?: import('./trace/types.js').TraceConfig;
  memory?: import('./memory/types.js').MemoryRuntimeConfig;
  context?: import('./context/types.js').ContextBuilderConfig;
  session?: import('./session/types.js').SessionRuntimeConfig;
  streaming?: import('./streaming/types.js').StreamingConfig;
  policy?: {
    enabled?: boolean;
    profileId?: string;
    actor?: ActorContext;
    delegation?: DelegationContext;
    approvalProvided?: boolean;
    allowProfilePolicyOverride?: boolean;
  };
}

export interface ToolTraceSink {
  recordToolExecutionStart: (toolName: string, input: unknown, toolCallId?: string) => void;
  recordToolExecutionFinish: (input: {
    toolName: string;
    toolCallId?: string;
    durationMs: number;
    ok: boolean;
    output?: unknown;
    error?: unknown;
  }) => void;
}

// ─── Step Display ────────────────────────────────────────────────────────────

export interface StepDisplay {
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'answer';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
}
