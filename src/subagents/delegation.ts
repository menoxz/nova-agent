import { randomUUID } from 'node:crypto';
import type { ActorContext, CapabilityCategory, DelegationContext } from '../policy/types.js';
import { getPolicyProfile } from '../policy/profiles.js';
import { getSubagentRole } from './registry.js';
import type { AuthorityGrant, SubagentRoleId, SubagentTask } from './types.js';

function intersect<T>(a: readonly T[], b: readonly T[]): T[] {
  const set = new Set(b);
  return a.filter((item) => set.has(item));
}

function intersectResources(a: readonly string[], b: readonly string[]): string[] {
  if (a.includes('*') && b.includes('*')) return ['*'];
  if (a.includes('*')) return [...b];
  if (b.includes('*')) return [...a];
  return intersect(a, b);
}

export function deriveEffectiveGrant(input: { parentGrant: AuthorityGrant; roleId: SubagentRoleId; requested?: Partial<AuthorityGrant>; policyProfileId?: string }): AuthorityGrant {
  const role = getSubagentRole(input.roleId);
  const profile = getPolicyProfile(input.policyProfileId ?? input.requested?.profileId ?? role.defaultGrant.profileId);
  const requestedCapabilities = input.requested?.capabilities ?? role.defaultGrant.capabilities;
  const requestedTools = input.requested?.tools ?? role.defaultGrant.tools;
  const requestedResources = input.requested?.resources ?? input.parentGrant.resources;

  const capabilities = intersect(intersect(input.parentGrant.capabilities, role.defaultGrant.capabilities), profile.allowedCapabilities)
    .filter((capability) => requestedCapabilities.includes(capability));
  const tools = intersect(intersect(input.parentGrant.tools, role.defaultGrant.tools), requestedTools);
  const resources = intersectResources(intersectResources(input.parentGrant.resources, role.defaultGrant.resources), requestedResources);

  if (requestedCapabilities.some((cap) => !capabilities.includes(cap))) throw new Error(`Delegation denied: child exceeds parent/role/profile capability grant (${requestedCapabilities.join(',')})`);
  if (requestedTools.some((tool) => !tools.includes(tool))) throw new Error(`Delegation denied: child requested tool outside parent/role grant (${requestedTools.join(',')})`);
  if (requestedResources.some((resource) => !resources.includes(resource))) throw new Error('Delegation denied: child requested resource outside parent/role grant');
  if (capabilities.includes('write' as CapabilityCategory) || capabilities.includes('shell' as CapabilityCategory)) throw new Error('Delegation denied: V1 roles do not grant write/shell without explicit ask/approval');

  return { profileId: profile.id, capabilities, tools, resources, approvalProvided: false };
}

export function createDelegationContext(input: { task: SubagentTask; parentActor: ActorContext; grant: AuthorityGrant }): { actor: ActorContext; delegation: DelegationContext } {
  const delegationId = `sub-${randomUUID()}`;
  const actor: ActorContext = {
    actorId: `${input.parentActor.actorId}:${input.task.id}`,
    actorType: 'sub_agent',
    sessionId: input.parentActor.sessionId,
    parentActorId: input.parentActor.actorId,
    delegationId,
    runId: input.parentActor.runId,
  };
  return {
    actor,
    delegation: {
      delegationId,
      parentActorId: input.parentActor.actorId,
      scope: input.task.scope ?? [],
      capabilities: input.grant.capabilities,
      tools: input.grant.tools,
      resources: input.grant.resources,
      budget: input.task.budget,
      report: { required: true, format: 'SubagentReport' },
    },
  };
}
