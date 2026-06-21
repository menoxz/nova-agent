import { getPolicyProfile } from './profiles.js';
import { defaultPolicyRules } from './rules.js';
import type { PolicyDecision, PolicyProfile, PolicyRequest, PolicyRule } from './types.js';

export interface EvaluatePolicyOptions {
  profile?: PolicyProfile;
  rules?: PolicyRule[];
}

export function evaluatePolicy(request: PolicyRequest, options: EvaluatePolicyOptions = {}): PolicyDecision {
  const profile = options.profile ?? getPolicyProfile(request.profileId ?? 'readonly');
  for (const rule of options.rules ?? defaultPolicyRules) {
    const result = rule.evaluate(request, profile);
    if (result) return result;
  }
  return { decision: 'deny', ruleId: 'engine-no-decision', reason: 'no policy rule produced a decision', safeMessage: 'Nova policy deny: no policy rule produced a decision' };
}

export function assertPolicyAllows(request: PolicyRequest, options: EvaluatePolicyOptions = {}): PolicyDecision {
  const decision = evaluatePolicy(request, options);
  if (decision.decision !== 'allow') {
    throw new Error(decision.safeMessage);
  }
  return decision;
}
