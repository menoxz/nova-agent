import { builtInProfiles } from './defaults.js';
import { effectiveAllowedTools } from './merge.js';
import { containsSecretLikeMaterial } from './security.js';
import { validateProfile } from './validate.js';
import type { AgentProfile, ResolvedAgentProfile } from './types.js';

export interface ProfileDoctorReport {
  id: string;
  source: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  safety: {
    secretLikeMaterial: boolean;
    allowsWriteFile: boolean;
    allowsBash: boolean;
    denyListWins: boolean;
    policyProfileId: string;
    compatibleRoles: string[];
  };
}

export function doctorProfile(profile: ResolvedAgentProfile | AgentProfile): ProfileDoctorReport {
  const validation = validateProfile(profile);
  const allowed = effectiveAllowedTools(profile);
  const secretLikeMaterial = containsSecretLikeMaterial(profile);
  const allowsWriteFile = allowed.includes('write_file');
  const allowsBash = allowed.includes('bash') || allowed.includes('shell') || allowed.includes('exec');
  const denyListWins = !profile.tools.denied.some((tool) => allowed.includes(tool));
  const warnings = [
    allowsWriteFile ? 'profile effective tools include write_file' : undefined,
    allowsBash ? 'profile effective tools include bash/shell/exec' : undefined,
    secretLikeMaterial ? 'profile contains secret-like material' : undefined,
  ].filter((value): value is string => Boolean(value));
  const source = 'source' in profile ? String(profile.source) : builtInProfiles.some((candidate) => candidate.identity.id === profile.identity.id) ? 'builtin' : 'custom';
  return {
    id: profile.identity.id,
    source,
    ok: validation.ok && warnings.length === 0 && denyListWins,
    errors: validation.errors,
    warnings,
    safety: {
      secretLikeMaterial,
      allowsWriteFile,
      allowsBash,
      denyListWins,
      policyProfileId: profile.policy.profileId,
      compatibleRoles: [...profile.subagent.compatibleRoles],
    },
  };
}
