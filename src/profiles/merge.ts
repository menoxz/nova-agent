import type { AgentProfile } from './types.js';

function mergeUnique(a: string[] = [], b: string[] = []): string[] {
  return [...new Set([...a, ...b])].sort();
}

export function effectiveAllowedTools(profile: Pick<AgentProfile, 'tools'>): string[] {
  const denied = new Set(profile.tools.denied);
  return profile.tools.allowed.filter((tool) => !denied.has(tool)).sort();
}

export function mergeProfiles(base: AgentProfile, overlay: Partial<AgentProfile>): AgentProfile {
  return {
    ...base,
    ...overlay,
    identity: { ...base.identity, ...overlay.identity },
    model: { ...base.model, ...overlay.model, overrideRules: { ...base.model.overrideRules, ...overlay.model?.overrideRules } },
    prompts: {
      ...base.prompts,
      ...overlay.prompts,
      constraints: mergeUnique(base.prompts.constraints, overlay.prompts?.constraints),
      style: mergeUnique(base.prompts.style, overlay.prompts?.style),
    },
    runtime: { ...base.runtime, ...overlay.runtime },
    tools: {
      allowed: mergeUnique(base.tools.allowed, overlay.tools?.allowed),
      denied: mergeUnique(base.tools.denied, overlay.tools?.denied),
      presets: mergeUnique(base.tools.presets, overlay.tools?.presets),
    },
    policy: { ...base.policy, ...overlay.policy, capabilities: mergeUnique(base.policy.capabilities, overlay.policy?.capabilities) as AgentProfile['policy']['capabilities'], approvalRequiredFor: mergeUnique(base.policy.approvalRequiredFor, overlay.policy?.approvalRequiredFor) },
    memory: { ...base.memory, ...overlay.memory, retention: { ...base.memory.retention, ...overlay.memory?.retention } },
    eval: { suiteIds: mergeUnique(base.eval.suiteIds, overlay.eval?.suiteIds), requiredGates: mergeUnique(base.eval.requiredGates, overlay.eval?.requiredGates), baselineHooks: mergeUnique(base.eval.baselineHooks, overlay.eval?.baselineHooks) },
    output: { ...base.output, ...overlay.output, requiredSections: mergeUnique(base.output.requiredSections, overlay.output?.requiredSections) },
    subagent: { ...base.subagent, ...overlay.subagent, compatibleRoles: mergeUnique(base.subagent.compatibleRoles, overlay.subagent?.compatibleRoles) },
  };
}
