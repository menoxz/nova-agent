import type { CapabilityCategory, PolicyDecision, PolicyRequest, ToolRiskLevel } from '../policy/types.js';
import type { ApprovalDecision } from '../session/types.js';

export interface ApprovalListItem {
  approvalId: string;
  sessionId: string;
  runId: string;
  status: ApprovalDecision;
  capability: CapabilityCategory;
  action: string;
  toolName?: string;
  riskLevel?: ToolRiskLevel;
  reason: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
}

export interface ApprovalDecisionInput {
  approvalId: string;
  decision: Extract<ApprovalDecision, 'approved' | 'denied'>;
  decidedBy?: string;
  reason?: string;
}

export interface ApprovalPolicyBridgeInput {
  sessionId: string;
  runId: string;
  request: PolicyRequest;
  decision: PolicyDecision;
}
