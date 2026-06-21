import type { CapabilityCategory, PolicyProfile } from './types.js';

const allCapabilities: CapabilityCategory[] = ['read', 'write', 'shell', 'network', 'git', 'mcp', 'lsp', 'memory', 'eval', 'trace'];

export const policyProfiles = {
  readonly: {
    id: 'readonly',
    label: 'Read-only',
    description: 'Default safe profile: read-only local inspection, read-only git, MCP/LSP metadata, eval/trace summaries; write and shell require explicit approval integration and are denied by default.',
    selectableByDefault: true,
    allowedCapabilities: ['read', 'git', 'mcp', 'lsp', 'eval', 'trace'],
    askCapabilities: ['write', 'shell', 'network', 'memory'],
    deniedCapabilities: [],
  },
  developer: {
    id: 'developer',
    label: 'Developer',
    description: 'Local development profile: allows reads, write-like local state, git inspection, network lookup; mutating writes and shell still ask before execution.',
    selectableByDefault: true,
    allowedCapabilities: ['read', 'git', 'mcp', 'lsp', 'eval', 'trace', 'network', 'memory'],
    askCapabilities: ['write', 'shell'],
    deniedCapabilities: [],
  },
  'trusted-local': {
    id: 'trusted-local',
    label: 'Trusted local',
    description: 'Non-default trusted local profile. Broad local capabilities remain constrained by path/redaction rules, and write/shell/network/memory still require explicit approval integration.',
    selectableByDefault: false,
    allowedCapabilities: allCapabilities,
    askCapabilities: ['write', 'shell', 'network', 'memory'],
    deniedCapabilities: [],
  },
  'ci-eval': {
    id: 'ci-eval',
    label: 'CI eval',
    description: 'Deterministic CI/eval profile: local reads, git inspection, eval/trace summaries; no shell, network, or writes.',
    selectableByDefault: true,
    allowedCapabilities: ['read', 'git', 'eval', 'trace', 'mcp', 'lsp'],
    askCapabilities: [],
    deniedCapabilities: ['write', 'shell', 'network', 'memory'],
  },
  'future-autonomous': {
    id: 'future-autonomous',
    label: 'Future autonomous placeholder',
    description: 'Placeholder for future autonomous capabilities. It is intentionally not selectable by default in Policy V1.',
    selectableByDefault: false,
    allowedCapabilities: allCapabilities,
    askCapabilities: ['write', 'shell', 'network', 'git', 'mcp', 'lsp', 'memory'],
    deniedCapabilities: [],
  },
} satisfies Record<string, PolicyProfile>;

export type PolicyProfileId = keyof typeof policyProfiles;

export function getPolicyProfile(id = 'readonly'): PolicyProfile {
  const profile = policyProfiles[id as PolicyProfileId];
  if (!profile) throw new Error(`Unknown policy profile: ${id}`);
  return profile;
}

export function listSelectablePolicyProfiles(): PolicyProfile[] {
  return Object.values(policyProfiles).filter((profile) => profile.selectableByDefault);
}
