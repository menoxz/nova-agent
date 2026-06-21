import { evaluatePolicy } from '../policy/engine.js';
import type { PolicyDecision, PolicyRequest } from '../policy/types.js';
import { SessionRunManager } from '../session/manager.js';
import type { SessionRuntimeConfig } from '../session/types.js';

export function createApprovalPolicyHook(config: SessionRuntimeConfig, active: { sessionId?: string; runId?: string }) {
  return async (request: PolicyRequest): Promise<PolicyDecision> => {
    const decision = evaluatePolicy(request);
    if (decision.decision === 'ask' && active.sessionId && active.runId) {
      const manager = new SessionRunManager(config);
      await manager.requestApproval(active.sessionId, active.runId, {
        capability: request.capability,
        action: request.action,
        riskLevel: request.riskLevel,
        reason: decision.safeMessage,
        safeMetadata: {
          ruleId: decision.ruleId,
          toolName: request.toolName,
          path: request.path,
          paths: request.paths,
        },
      }).catch(() => undefined);
    }
    return decision;
  };
}
