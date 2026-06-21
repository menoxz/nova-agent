/**
 * Nova Agent — Core Types
 */

import type { z } from 'zod';
import type { FlexibleSchema, ToolResultOutput } from '@ai-sdk/provider-utils';

// ─── LLM Provider ────────────────────────────────────────────────────────────

export type LLMProviderName = 'deepseek' | 'openai' | 'openrouter' | string;

export interface LLMConfig {
  provider: LLMProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
}

// ─── Tool System ─────────────────────────────────────────────────────────────

/**
 * Internal Nova tool definition (before conversion to AI SDK format).
 */
export interface NovaTool {
  name: string;
  description: string;
  inputSchema: FlexibleSchema<any>;
  execute: (input: any, options?: { toolCallId?: string }) => Promise<string | ToolResultOutput>;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface AgentConfig {
  llm: LLMConfig;
  systemPrompt: string;
  maxSteps?: number;
  trace?: import('./trace/types.js').TraceConfig;
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
