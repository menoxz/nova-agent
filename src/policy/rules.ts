import { deniedPathReason, resolvePolicyPath } from './path.js';
import { containsPrivateKeyMaterial } from './redact.js';
import type { CapabilityCategory, PolicyDecision, PolicyRequest, PolicyRule } from './types.js';

function decision(kind: PolicyDecision['decision'], ruleId: string, reason: string, matchedPath?: string): PolicyDecision {
  return { decision: kind, ruleId, reason, safeMessage: `Nova policy ${kind}: ${reason}`, requiresApproval: kind === 'ask', matchedPath };
}

function hasCapability(capabilities: CapabilityCategory[] | undefined, capability: CapabilityCategory): boolean {
  return Boolean(capabilities?.includes(capability));
}

function candidatePaths(request: PolicyRequest): string[] {
  return [request.path, ...(request.paths ?? [])].filter((path): path is string => typeof path === 'string' && Boolean(path.trim()));
}

function resourceAllowsPath(resource: string, path: string): boolean {
  if (resource === '*') return true;
  const resourceCheck = resolvePolicyPath(resource, 'delegation resource', undefined);
  const pathCheck = resolvePolicyPath(path, 'delegation path', undefined);
  if (!resourceCheck.ok || !pathCheck.ok) return false;
  return pathCheck.path === resourceCheck.path || pathCheck.path.startsWith(`${resourceCheck.path}${process.platform === 'win32' ? '\\' : '/'}`);
}

export const defaultPolicyRules: PolicyRule[] = [
  {
    id: 'future-autonomous-not-default',
    description: 'The future-autonomous placeholder cannot be selected by default.',
    evaluate: (_request, profile) => profile.id === 'future-autonomous' && !profile.selectableByDefault
      ? decision('deny', 'future-autonomous-not-default', 'future-autonomous profile is a placeholder and is not selectable by default')
      : undefined,
  },
  {
    id: 'child-exceeds-parent',
    description: 'Delegated child actors cannot exceed parent-scoped capabilities.',
    evaluate: (request) => {
      if (request.actor.actorType !== 'sub_agent') return undefined;
      if (!request.delegation?.capabilities?.length) return decision('deny', 'child-exceeds-parent', 'sub-agent delegation has no granted capabilities');
      if (!request.delegation.capabilities.includes(request.capability)) return decision('deny', 'child-exceeds-parent', `sub-agent requested capability outside parent delegation: ${request.capability}`);
      if (request.toolName && request.delegation.tools?.length && !request.delegation.tools.includes(request.toolName)) return decision('deny', 'child-exceeds-parent', `sub-agent requested tool outside parent delegation: ${request.toolName}`);
      const paths = candidatePaths(request);
      if (paths.length) {
        const resources = request.delegation.resources ?? [];
        if (!resources.length) return decision('deny', 'child-exceeds-parent', 'sub-agent delegation has no granted resources');
        for (const path of paths) {
          if (!resources.some((resource) => resourceAllowsPath(resource, path))) return decision('deny', 'child-exceeds-parent', 'sub-agent requested path outside delegated resources');
        }
      }
      return undefined;
    },
  },
  {
    id: 'path-traversal-outside-root-denylist',
    description: 'Deny traversal, NUL, outside-root, .env, .git, node_modules, raw .nova artifacts, private-key and secret-like filenames.',
    evaluate: (request, profile) => {
      for (const path of candidatePaths(request)) {
        const check = resolvePolicyPath(path, 'path', undefined);
        if (!check.ok) return decision('deny', 'path-traversal-outside-root-denylist', check.reason, check.safePath);
      }
      if (request.toolName && deniedPathReason(request.toolName)) return decision('deny', 'path-traversal-outside-root-denylist', 'secret-like tool/path name is denied');
      void profile;
      return undefined;
    },
  },
  {
    id: 'private-key-content-deny',
    description: 'Deny private key material in provided content previews.',
    evaluate: (request) => request.contentPreview && containsPrivateKeyMaterial(request.contentPreview)
      ? decision('deny', 'private-key-content-deny', 'private key material detected in content')
      : undefined,
  },
  {
    id: 'profile-denied-capability',
    description: 'Deny capabilities explicitly denied by the active profile.',
    evaluate: (request, profile) => hasCapability(profile.deniedCapabilities, request.capability)
      ? decision('deny', 'profile-denied-capability', `${request.capability} is denied by profile ${profile.id}`)
      : undefined,
  },
  {
    id: 'ask-mutating-or-shell',
    description: 'Mutating writes and shell execution ask unless explicitly allowed by a trusted profile/approval layer.',
    evaluate: (request, profile) => {
      if (hasCapability(profile.askCapabilities, request.capability)) return decision('ask', 'ask-mutating-or-shell', `${request.capability} requires explicit approval`);
      if ((request.capability === 'write' || request.capability === 'shell') && !hasCapability(profile.allowedCapabilities, request.capability)) return decision('ask', 'ask-mutating-or-shell', `${request.capability} requires explicit approval`);
      return undefined;
    },
  },
  {
    id: 'deny-unlisted-capability',
    description: 'No silent escalation: capabilities not allowed by the profile are denied.',
    evaluate: (request, profile) => !hasCapability(profile.allowedCapabilities, request.capability)
      ? decision('deny', 'deny-unlisted-capability', `${request.capability} is not allowed by profile ${profile.id}`)
      : undefined,
  },
  {
    id: 'allow-readonly',
    description: 'Allow read-only/profile-approved requests that survived all deny and ask rules.',
    evaluate: (request) => decision('allow', 'allow-readonly', request.readOnly === false ? 'profile-approved non-read request' : 'read-only request allowed'),
  },
];
