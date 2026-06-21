import { getPolicyProfile } from '../policy/profiles.js';
import { evalSuites } from '../eval/suites.js';
import { agentProfileSchema } from './schema.js';
import { assertNoProfileSecrets } from './security.js';
import type { AgentProfile, ProfileValidationResult } from './types.js';

export function validateProfile(value: unknown): ProfileValidationResult {
  const errors: string[] = [];
  try { assertNoProfileSecrets(value); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  const parsed = agentProfileSchema.safeParse(value);
  if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  if (parsed.success) {
    const profile = parsed.data as AgentProfile;
    try { getPolicyProfile(profile.policy.profileId); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
    for (const suiteId of profile.eval.suiteIds) {
      if (!Object.hasOwn(evalSuites, suiteId)) errors.push(`Unknown eval suite: ${suiteId}`);
    }
    for (const tool of profile.tools.allowed.filter((name) => profile.tools.denied.includes(name))) {
      errors.push(`Tool "${tool}" appears in both allowed and denied; denied wins but profile must be explicit`);
    }
    const dangerousAllowed = profile.tools.allowed.filter((tool) => /(^|[_:-])(write|bash|shell|exec|delete|remove|rm)([_:-]|$)/i.test(tool));
    if (dangerousAllowed.length && !profile.policy.approvalRequiredFor.some((item) => ['write', 'shell', 'high', 'critical'].includes(item))) {
      errors.push(`Dangerous tools require approvalRequiredFor write/shell/high/critical: ${dangerousAllowed.join(', ')}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidProfile(value: unknown): AgentProfile {
  const result = validateProfile(value);
  if (!result.ok) throw new Error(`Invalid agent profile: ${result.errors.join('; ')}`);
  return agentProfileSchema.parse(value) as AgentProfile;
}
