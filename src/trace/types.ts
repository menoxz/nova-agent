/**
 * Nova Agent — Structured tracing types
 *
 * Traces are intentionally local-first and redact likely secrets by default.
 */

export type TraceStatus = 'running' | 'success' | 'error';
export type TraceSchemaVersion = 1 | 2;
export type TraceToolKind = 'builtin' | 'mcp' | 'lsp' | 'external';

export interface TraceConfig {
  /** Enable structured trace capture for agent runs. */
  enabled?: boolean;
  /** Directory where trace JSON files are written. Defaults to .nova/traces. */
  outputDir?: string;
  /** Include prompt/final/tool content previews. Defaults to true with redaction/truncation. */
  includeContent?: boolean;
  /** Maximum characters kept for any string preview. Defaults to 2_000. */
  contentMaxChars?: number;
  /** Append a compact JSONL index next to run JSON files. Defaults to true. */
  writeJsonlIndex?: boolean;
  /** Include redacted error stacks. Defaults to false; intended for explicit local debugging only. */
  includeErrorStack?: boolean;
  /** Optional prefix for generated run IDs. */
  runIdPrefix?: string;
  /** Optional resolved agent profile attribution. */
  profile?: {
    profileId: string;
    profileVersion: string;
    profileHash: string;
    source: 'builtin' | 'custom' | 'imported';
    mode: 'root' | 'subagent' | 'tool_worker';
    policyProfileId?: string;
  };
}

export interface TraceMetrics {
  durationMs: number;
  stepCount: number;
  reasoningStepCount: number;
  toolCallCount: number;
  toolResultCount: number;
  toolExecutionCount: number;
  errorCount: number;
  finalAnswerChars: number;
}

export interface TraceEventBase {
  id: string;
  type: string;
  timestamp: string;
  elapsedMs: number;
}

export interface RunStartEvent extends TraceEventBase {
  type: 'run_start';
  input?: { preview: string; charCount: number };
  config: {
    model: string;
    maxSteps: number;
    toolNames: string[];
    toolCatalog?: Array<{ name: string; kind: TraceToolKind }>;
    profile?: NonNullable<TraceConfig['profile']>;
  };
}

export interface LlmStepEvent extends TraceEventBase {
  type: 'llm_step';
  text?: string;
  toolCallCount: number;
  toolResultCount: number;
}

export interface ToolCallEvent extends TraceEventBase {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  toolKind?: TraceToolKind;
  input?: unknown;
}

export interface ToolResultEvent extends TraceEventBase {
  type: 'tool_result';
  toolCallId?: string;
  toolName: string;
  toolKind?: TraceToolKind;
  output?: unknown;
}

export interface ToolExecutionStartEvent extends TraceEventBase {
  type: 'tool_execution_start';
  toolCallId?: string;
  toolName: string;
  toolKind?: TraceToolKind;
  input?: unknown;
}

export interface ToolExecutionFinishEvent extends TraceEventBase {
  type: 'tool_execution_finish';
  toolCallId?: string;
  toolName: string;
  toolKind?: TraceToolKind;
  durationMs: number;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface PolicyAuditTraceEvent extends TraceEventBase {
  type: 'policy_audit';
  policyEvent: import('../policy/types.js').PolicyAuditEvent;
}

export interface FinalAnswerEvent extends TraceEventBase {
  type: 'final_answer';
  text?: string;
  charCount: number;
}

export interface ErrorEvent extends TraceEventBase {
  type: 'error';
  message: string;
  name?: string;
  stack?: string;
}

export type TraceEvent =
  | RunStartEvent
  | LlmStepEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolExecutionStartEvent
  | ToolExecutionFinishEvent
  | PolicyAuditTraceEvent
  | FinalAnswerEvent
  | ErrorEvent;

export interface TraceRun {
  schemaVersion: TraceSchemaVersion;
  runId: string;
  startedAt: string;
  endedAt?: string;
  status: TraceStatus;
  outputPath?: string;
  metrics: TraceMetrics;
  events: TraceEvent[];
}

export interface TraceFinishResult {
  run: TraceRun;
  outputPath?: string;
}
