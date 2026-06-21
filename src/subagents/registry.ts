import { SUBAGENT_ROLES } from './roles.js';
import type { SubagentRole, SubagentRoleId } from './types.js';

const roleMap = new Map<SubagentRoleId, SubagentRole>(SUBAGENT_ROLES.map((role) => [role.id, role]));

export function listSubagentRoles(): SubagentRole[] {
  return [...SUBAGENT_ROLES];
}

export function getSubagentRole(id: SubagentRoleId): SubagentRole {
  const role = roleMap.get(id);
  if (!role) throw new Error(`Unknown sub-agent role: ${id}`);
  return role;
}

export function hasSubagentRole(id: string): id is SubagentRoleId {
  return roleMap.has(id as SubagentRoleId);
}
