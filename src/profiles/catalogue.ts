import { sanitizeProfileMetadata } from './audit.js';
import { builtInProfiles } from './defaults.js';
import { resolveProfileSync } from './resolver.js';
import type { AgentProfileMetadata } from './types.js';

export function builtInProfileCatalogue(): AgentProfileMetadata[] {
  return builtInProfiles.map((profile) => sanitizeProfileMetadata(resolveProfileSync({ profileId: profile.identity.id, includeCustom: false }))).sort((a, b) => a.id.localeCompare(b.id));
}

export function findBuiltInProfileMetadata(id: string): AgentProfileMetadata | undefined {
  return builtInProfileCatalogue().find((profile) => profile.id === id);
}
