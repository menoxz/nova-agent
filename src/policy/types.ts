export type ActorType =
  | 'user'
  | 'root_agent'
  | 'sub_agent'
  | 'tool'
  | 'mcp_client'
  | 'mcp_server'
  | 'lsp_client'
  | 'lsp_server'
  | 'eval_runner'
  | 'system';

export type CapabilityCategory = 'read' | 'write' | 'shell' | 'network' | 'git' | 'mcp' | 'lsp' | 'memory' | 'eval' | 'trace';
export type PolicyDecisionKind = 'allow' | 'deny' | 'ask';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ActorContext {
  actorId: string;
  actorType: ActorType;
  sessionId?: string;
  parentActorId?: string;
  delegationId?: string;
  runId?: string;
}

export interface DelegationContext {
  delegationId?: string;
  parentActorId?: string;
  scope?: string[];
  capabilities?: CapabilityCategory[];
  tools?: string[];
  resources?: string[];
  context?: string;
  budget?: { maxToolCalls?: number; maxDurationMs?: number; maxOutputChars?: number };
  report?: { required?: boolean; format?: string };
}

export interface PolicyProfile {
  id: string;
  label: string;
  description: string;
  selectableByDefault: boolean;
  allowedCapabilities: CapabilityCategory[];
  askCapabilities?: CapabilityCategory[];
  deniedCapabilities?: CapabilityCategory[];
  allowedRoots?: string[];
}

export interface PolicyRequest {
  requestId?: string;
  actor: ActorContext;
  delegation?: DelegationContext;
  profileId?: string;
  capability: CapabilityCategory;
  action: string;
  toolName?: string;
  path?: string;
  paths?: string[];
  input?: unknown;
  contentPreview?: string;
  readOnly?: boolean;
  riskLevel?: ToolRiskLevel;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  ruleId: string;
  reason: string;
  safeMessage: string;
  requiresApproval?: boolean;
  matchedPath?: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  evaluate: (request: PolicyRequest, profile: PolicyProfile) => PolicyDecision | undefined;
}

export interface PolicyAuditEvent {
  id: string;
  timestamp: string;
  actor: ActorContext;
  delegationId?: string;
  profileId: string;
  action: string;
  capability: CapabilityCategory;
  toolName?: string;
  decision: PolicyDecisionKind;
  ruleId: string;
  reason: string;
  safePath?: string;
  riskLevel?: ToolRiskLevel;
}
