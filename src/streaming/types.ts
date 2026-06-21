import type { ResponseTokenMetrics } from '../tokens/types.js';

export interface StreamingConfig {
  enabled?: boolean;
  showTokens?: boolean;
  showTools?: boolean;
  showThinking?: boolean;
  thinkingMode?: 'hidden' | 'collapsed' | 'expanded';
  showMetrics?: boolean;
  showCost?: boolean;
  refreshMs?: number;
}

export type StreamingEvent =
  | { type: 'start'; timestamp: string; sessionId?: string; runId?: string; model: string; estimatedPromptTokens?: number }
  | { type: 'status'; timestamp: string; message: string; sessionId?: string; runId?: string }
  | { type: 'token'; timestamp: string; text: string; completionTokens: number; elapsedMs: number }
  | { type: 'reasoning_start'; timestamp: string; id?: string }
  | { type: 'reasoning_delta'; timestamp: string; id?: string; text: string; elapsedMs: number }
  | { type: 'reasoning_end'; timestamp: string; id?: string; text: string }
  | { type: 'tool_call'; timestamp: string; toolCallId?: string; toolName: string; inputPreview?: string }
  | { type: 'tool_result'; timestamp: string; toolCallId?: string; toolName: string; outputPreview: string; ok: boolean }
  | { type: 'metrics'; timestamp: string; metrics: ResponseTokenMetrics }
  | { type: 'finish'; timestamp: string; text: string; metrics: ResponseTokenMetrics; elapsedMs: number; toolCallCount: number }
  | { type: 'error'; timestamp: string; message: string; elapsedMs: number };

export interface AgentRunOptions {
  streaming?: boolean;
  onEvent?: (event: StreamingEvent) => void | Promise<void>;
}

export const DEFAULT_STREAMING_CONFIG: Required<StreamingConfig> = {
  enabled: false,
  showTokens: true,
  showTools: true,
  showThinking: true,
  thinkingMode: 'collapsed',
  showMetrics: true,
  showCost: true,
  refreshMs: 250,
};

export function resolveStreamingConfig(config?: StreamingConfig): Required<StreamingConfig> {
  return { ...DEFAULT_STREAMING_CONFIG, ...config };
}
