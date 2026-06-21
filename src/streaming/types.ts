import type { ResponseTokenMetrics } from '../tokens/types.js';

export type StreamingMode = 'compact' | 'normal' | 'verbose';
export type StreamingThinkingMode = 'hidden' | 'collapsed' | 'expanded';
export type RuntimeEventSeverity = 'debug' | 'info' | 'warn' | 'error';
export type RuntimeEventSource = 'runtime' | 'llm' | 'tool' | 'session' | 'cli';

export interface StreamingConfig {
  enabled?: boolean;
  mode?: StreamingMode;
  showTokens?: boolean;
  showTools?: boolean;
  showThinking?: boolean;
  thinkingMode?: StreamingThinkingMode;
  showMetrics?: boolean;
  showCost?: boolean;
  refreshMs?: number;
  eventLog?: StreamingEventLogConfig;
}

export interface StreamingEventLogConfig {
  enabled?: boolean;
  root?: string;
  includeText?: boolean;
  maxTextChars?: number;
  maxEvents?: number;
}

export interface RuntimeEventMeta {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  timestamp: string;
  source: RuntimeEventSource;
  severity: RuntimeEventSeverity;
  sessionId?: string;
  runId?: string;
}

export type StreamingEventPayload =
  | { type: 'start'; model: string; estimatedPromptTokens?: number }
  | { type: 'status'; message: string }
  | { type: 'token'; text: string; completionTokens: number; elapsedMs: number }
  | { type: 'reasoning_start'; id?: string }
  | { type: 'reasoning_delta'; id?: string; text: string; elapsedMs: number }
  | { type: 'reasoning_end'; id?: string; text: string }
  | { type: 'tool_call'; toolCallId?: string; toolName: string; inputPreview?: string }
  | { type: 'tool_result'; toolCallId?: string; toolName: string; outputPreview: string; ok: boolean }
  | { type: 'metrics'; metrics: ResponseTokenMetrics }
  | { type: 'finish'; text: string; metrics: ResponseTokenMetrics; elapsedMs: number; toolCallCount: number }
  | { type: 'error'; message: string; elapsedMs: number };

export type RuntimeStreamingEvent = RuntimeEventMeta & StreamingEventPayload;

/** Backward-compatible public stream event shape, now normalized for TUI consumption. */
export type StreamingEvent = RuntimeStreamingEvent;

export interface AgentRunOptions {
  streaming?: boolean;
  onEvent?: (event: StreamingEvent) => void | Promise<void>;
}

export const DEFAULT_STREAMING_CONFIG: Required<StreamingConfig> = {
  enabled: false,
  mode: 'normal',
  showTokens: true,
  showTools: true,
  showThinking: true,
  thinkingMode: 'collapsed',
  showMetrics: true,
  showCost: true,
  refreshMs: 250,
  eventLog: {
    enabled: false,
    root: '.nova/streaming/events',
    includeText: true,
    maxTextChars: 2_000,
    maxEvents: 20_000,
  },
};

export function resolveStreamingConfig(config?: StreamingConfig): Required<StreamingConfig> {
  return { ...DEFAULT_STREAMING_CONFIG, ...config, eventLog: { ...DEFAULT_STREAMING_CONFIG.eventLog, ...config?.eventLog } };
}
