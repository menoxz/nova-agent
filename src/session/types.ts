import type { CapabilityCategory, ToolRiskLevel } from '../policy/types.js';
import type { ResponseTokenMetrics, TokenCostEstimate } from '../tokens/types.js';

export const SESSION_SCHEMA_VERSION = 1 as const;

export type SessionStatus = 'active' | 'idle' | 'closed' | 'archived';
export type RunStatus = 'planned' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled';
export type RunEventType = 'created' | 'started' | 'planned' | 'context_built' | 'tool_call' | 'subagent' | 'approval_requested' | 'approval_decided' | 'checkpoint' | 'resumed' | 'finished' | 'error';
export type ApprovalDecision = 'pending' | 'approved' | 'denied' | 'expired';

export interface SessionRuntimeConfig {
  enabled?: boolean;
  projectRoot?: string;
  sessionsRoot?: string;
  defaultSessionId?: string;
  autoCreate?: boolean;
  title?: string;
  userId?: string;
  projectId?: string;
  tags?: string[];
  defaultBudget?: RunBudgetLimit;
  conversation?: ConversationRuntimeConfig;
}

export interface SessionRecord {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  title: string;
  objective?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  activeRunId?: string;
  runIds: string[];
  metadata: {
    userId?: string;
    profileId?: string;
    projectId?: string;
    tags: string[];
  };
}

export interface RunBudgetLimit {
  maxToolCalls?: number;
  maxDurationMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  currency?: string;
}

export interface RunBudgetUsage {
  toolCalls: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  responseTokensPerSecond?: number;
  cost?: TokenCostEstimate;
  exceeded: string[];
}

export interface RunPlanStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'blocked';
  kind: 'understand' | 'inspect' | 'act' | 'verify' | 'report' | 'approval';
}

export interface RunPlan {
  strategy: 'minimal' | 'standard';
  createdAt: string;
  steps: RunPlanStep[];
}

export interface ApprovalRequestRecord {
  id: string;
  status: ApprovalDecision;
  capability: CapabilityCategory;
  action: string;
  riskLevel?: ToolRiskLevel;
  reason: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  safeMetadata?: Record<string, unknown>;
}

export interface RunObservabilityLinks {
  traceRunId?: string;
  tracePath?: string;
  evalRunId?: string;
  evalReportPath?: string;
  memory?: import('../memory/types.js').MemoryTraceSummary;
  context?: import('../context/types.js').ContextBudgetTrace;
  subagents?: Array<{ taskId: string; role: string; status: string }>;
}

export interface RunEventRecord {
  id: string;
  type: RunEventType;
  timestamp: string;
  message: string;
  safeMetadata?: Record<string, unknown>;
}

export interface RunRecord {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  status: RunStatus;
  objective: string;
  inputPreview: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  plan: RunPlan;
  budget: {
    limit: RunBudgetLimit;
    usage: RunBudgetUsage;
  };
  approvals: ApprovalRequestRecord[];
  observability: RunObservabilityLinks;
  events: RunEventRecord[];
  finalReport?: RunFinalReport;
  relationships?: {
    parentRunId?: string;
    resumedFromRunId?: string;
    childRunIds?: string[];
  };
  resume?: RunResumeMetadata;
}

export interface RunResumeMetadata {
  sourceRunId: string;
  createdAt: string;
  createdBy: 'local-cli' | 'runtime';
  mode: 'child_run';
  reason?: string;
  approvedApprovalIds: string[];
  deniedApprovalIds: string[];
  pendingApprovalIds: string[];
  safety: {
    autoExecuteApprovedActions: false;
    rawToolInputsIncluded: false;
    llmInvoked: false;
  };
}

export interface RunFinalReport {
  status: RunStatus;
  summary: string;
  completedSteps: number;
  blockedSteps: number;
  approvalCount: number;
  budgetExceeded: string[];
  metrics: RunBudgetUsage;
  endedAt: string;
}

export interface SessionIndex {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  updatedAt: string;
  sessions: Array<{ id: string; title: string; status: SessionStatus; updatedAt: string; activeRunId?: string; runCount: number }>;
  runs: Array<{ id: string; sessionId: string; status: RunStatus; objective: string; updatedAt: string }>;
}

export interface CurrentSessionPointer {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  runId?: string;
  updatedAt: string;
  source: 'cli' | 'agent' | 'resume' | 'runtime';
  safety: {
    metadataOnly: true;
    secretsIncluded: false;
    rawPromptsIncluded: false;
    rawToolInputsIncluded: false;
  };
}

export interface StartRunInput {
  sessionId: string;
  objective: string;
  input: string;
  budget?: RunBudgetLimit;
  observability?: RunObservabilityLinks;
}

export interface FinishRunInput {
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  summary: string;
  tokenMetrics?: ResponseTokenMetrics;
  toolCalls?: number;
  observability?: Partial<RunObservabilityLinks>;
}

export interface RunReplaySummary {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  runId: string;
  status: RunStatus;
  objective: string;
  inputPreview: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  plan: RunPlan;
  budget: RunRecord['budget'];
  approvals: ApprovalRequestRecord[];
  observability: RunObservabilityLinks;
  events: RunEventRecord[];
  finalReport?: RunFinalReport;
  relationships?: RunRecord['relationships'];
  resume?: RunResumeMetadata;
  safety: {
    metadataOnly: true;
    llmInvoked: false;
    toolsInvoked: false;
    rawToolInputsIncluded: false;
    secretsIncluded: false;
  };
}

export interface ConversationRuntimeConfig {
  enabled?: boolean;
  maxTurns?: number;
  keepRecentTurns?: number;
  maxPreviewChars?: number;
  summaryMaxChars?: number;
}

export interface ConversationTurnRecord {
  id: string;
  sessionId: string;
  runId?: string;
  createdAt: string;
  userPreview: string;
  assistantSummary: string;
  status?: RunStatus;
  toolCallCount: number;
  approvalIds: string[];
  approvedApprovalIds: string[];
  deniedApprovalIds: string[];
  pendingApprovalIds: string[];
  budgetExceeded: string[];
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  redacted: boolean;
  metadataOnly: true;
}

export interface ConversationSummaryRecord {
  updatedAt: string;
  compactedAt?: string;
  turnCount: number;
  retainedTurnCount: number;
  lastRunId?: string;
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  runIds: string[];
  approvalIds: string[];
  text: string;
  safety: {
    deterministic: true;
    llmInvoked: false;
    metadataOnly: true;
    rawPromptsIncluded: false;
    rawToolInputsIncluded: false;
    secretsIncluded: false;
  };
}

export interface ConversationRecord {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turns: ConversationTurnRecord[];
  summary: ConversationSummaryRecord;
  safety: {
    bounded: true;
    redacted: boolean;
    metadataFirst: true;
    rawPromptsIncluded: false;
    rawToolInputsIncluded: false;
    secretsIncluded: false;
  };
}

export interface AddConversationTurnInput {
  sessionId: string;
  run?: RunRecord;
  userInput: string;
  assistantText: string;
  toolCallCount?: number;
}
