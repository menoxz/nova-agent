import type { SubagentRole } from './types.js';

const READ_TOOLS = ['read_file', 'glob', 'grep', 'list_directory', 'get_file_info', 'git'];

export const SUBAGENT_ROLES: readonly SubagentRole[] = [
  {
    id: 'researcher',
    label: 'Researcher',
    purpose: 'Find and summarize evidence from allowlisted context.',
    values: ['specialization', 'context_management', 'parallelism'],
    defaultGrant: { profileId: 'readonly', capabilities: ['read', 'git'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'architect',
    label: 'Architect',
    purpose: 'Design bounded implementation plans and interfaces.',
    values: ['specialization', 'risk_isolation'],
    defaultGrant: { profileId: 'readonly', capabilities: ['read'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'builder',
    label: 'Builder',
    purpose: 'Produce implementation guidance within explicit scope; write/shell still require policy ask/approval.',
    values: ['specialization', 'risk_isolation'],
    defaultGrant: { profileId: 'developer', capabilities: ['read'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    purpose: 'Independently review work produced by another role.',
    values: ['independent_verification', 'risk_isolation'],
    defaultGrant: { profileId: 'readonly', capabilities: ['read', 'git'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'security',
    label: 'Security',
    purpose: 'Check security and policy safety without exposing sensitive content.',
    values: ['specialization', 'risk_isolation', 'independent_verification'],
    defaultGrant: { profileId: 'readonly', capabilities: ['read', 'git', 'trace', 'eval'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'qa',
    label: 'QA',
    purpose: 'Verify acceptance criteria independently from producers.',
    values: ['independent_verification', 'parallelism'],
    defaultGrant: { profileId: 'ci-eval', capabilities: ['read', 'git', 'eval'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'docs',
    label: 'Docs',
    purpose: 'Prepare documentation/report content from scoped facts.',
    values: ['specialization', 'context_management'],
    defaultGrant: { profileId: 'readonly', capabilities: ['read'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
  {
    id: 'refactor',
    label: 'Refactor',
    purpose: 'Suggest low-risk refactors within explicit scope; mutations remain gated by policy.',
    values: ['specialization', 'risk_isolation'],
    defaultGrant: { profileId: 'developer', capabilities: ['read'], tools: READ_TOOLS, resources: ['*'] },
    readOnly: true,
  },
] as const;
