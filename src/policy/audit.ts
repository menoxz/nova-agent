import { randomUUID } from 'node:crypto';

import { safeRelative } from './path.js';
import { redactString } from './redact.js';
import type { PolicyAuditEvent, PolicyDecision, PolicyProfile, PolicyRequest } from './types.js';

export function createPolicyAuditEvent(request: PolicyRequest, decision: PolicyDecision, profile: PolicyProfile): PolicyAuditEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: request.actor,
    delegationId: request.delegation?.delegationId ?? request.actor.delegationId,
    profileId: profile.id,
    action: redactString(request.action, 200),
    capability: request.capability,
    toolName: request.toolName,
    decision: decision.decision,
    ruleId: decision.ruleId,
    reason: redactString(decision.reason, 500),
    safePath: request.path ? safeRelative(request.path) : undefined,
    riskLevel: request.riskLevel,
  };
}
