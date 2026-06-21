import type { ActorContext, CapabilityCategory, DelegationContext, PolicyDecisionKind } from '../policy/types.js';
import type { StepDisplay } from '../types.js';

export type SubagentRoleId = 'researcher' | 'architect' | 'builder' | 'reviewer' | 'security' | 'qa' | 'docs' | 'refactor';
export type SubagentValue = 'specialization' | 'risk_isolation' | 'independent_verification' | 'context_management' | 'parallelism';
export type SubagentTaskKind = 'produce' | 'verify' | 'review' | 'research' | 'document' | 'refactor';
export type SubagentTaskStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped';

export interface AuthorityGrant {
  capabilities: CapabilityCategory[];
  tools: string[];
  resources: string[];
  profileId: string;
  approvalProvided?: boolean;
}

export interface SubagentRole {
  id: SubagentRoleId;
  label: string;
  purpose: string;
  values: SubagentValue[];
  defaultGrant: AuthorityGrant;
  defaultProfileId?: string;
  readOnly: boolean;
}

export interface ContextOmission {
  resource: string;
  reason: string;
}

export interface ScopedContextResource {
  requested: string;
  resolved: string;
  safePath: string;
  content?: string;
  bytes: number;
  omittedBytes: number;
  redacted: boolean;
}

export interface ScopedContext {
  root: string;
  resources: ScopedContextResource[];
  omissions: ContextOmission[];
  caps: { maxFiles: number; maxBytesPerFile: number; maxTotalBytes: number };
}

export interface SubagentBudget {
  maxToolCalls: number;
  maxDurationMs: number;
  maxOutputChars: number;
}

export interface BudgetState extends SubagentBudget {
  toolCalls: number;
  startedAt: number;
  outputChars: number;
}

export interface SubagentTask {
  id: string;
  role: SubagentRoleId;
  kind: SubagentTaskKind;
  prompt: string;
  dependsOn?: string[];
  scope?: string[];
  requestedGrant?: Partial<AuthorityGrant>;
  profileId?: string;
  profileMetadata?: import('../profiles/types.js').AgentProfileMetadata;
  budget?: Partial<SubagentBudget>;
  producerTaskId?: string;
  securitySensitive?: boolean;
}

export interface SubagentReport {
  taskId: string;
  role: SubagentRoleId;
  status: Exclude<SubagentTaskStatus, 'pending' | 'running'>;
  summary: string;
  findings: string[];
  evidence: string[];
  risks: string[];
  verification?: { independent: boolean; producerTaskId?: string; method: string };
  budget: { toolCalls: number; durationMs: number; outputChars: number; exhausted: boolean };
  context: { included: string[]; omissions: ContextOmission[] };
  steps?: StepDisplay[];
}

export interface WorkerRunInput {
  task: SubagentTask;
  parentActor: ActorContext;
  parentGrant: AuthorityGrant;
  root: string;
  policyProfileId?: string;
  context?: ScopedContext;
}

export interface WorkerRunResult {
  task: SubagentTask;
  actor: ActorContext;
  delegation: DelegationContext;
  grant: AuthorityGrant;
  report: SubagentReport;
}

export interface SubagentLifecycleEvent {
  id: string;
  timestamp: string;
  type: 'delegation_created' | 'worker_started' | 'worker_finished' | 'worker_denied' | 'graph_ready' | 'graph_rejected';
  actor: ActorContext;
  delegationId?: string;
  taskId?: string;
  role?: SubagentRoleId;
  decision?: PolicyDecisionKind;
  reason?: string;
  safeMetadata?: Record<string, unknown>;
}
