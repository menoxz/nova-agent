import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertPathUnderDir } from '../utils/safe_io.js';
import { sanitizeProfileMetadata } from './audit.js';
import { hashProfile } from './hash.js';
import { migrateProfile } from './migrations.js';
import { assertNoProfileSecrets } from './security.js';
import { assertValidProfile } from './validate.js';
import type { AgentProfile, AgentProfileMetadata, ResolvedAgentProfile } from './types.js';

export function customProfilesDir(projectRoot = process.cwd()): string {
  return resolve(projectRoot, '.nova', 'profiles', 'custom');
}

export async function loadCustomProfiles(projectRoot = process.cwd()): Promise<AgentProfile[]> {
  const dir = customProfilesDir(projectRoot);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const profiles: AgentProfile[] = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
      const path = assertPathUnderDir(join(dir, entry.name), dir, 'Custom profile path');
      const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
      assertNoProfileSecrets(raw, path);
      profiles.push(assertValidProfile(migrateProfile(raw)));
    }
    return profiles;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeCustomProfile(profile: AgentProfile, projectRoot = process.cwd()): Promise<string> {
  assertNoProfileSecrets(profile);
  const valid = assertValidProfile(profile);
  const dir = customProfilesDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const path = assertPathUnderDir(join(dir, `${valid.identity.id}.json`), dir, 'Custom profile path');
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, 'utf-8');
  return path;
}

export function toResolvedCustomProfile(profile: AgentProfile): ResolvedAgentProfile {
  const hash = hashProfile(profile);
  return { ...profile, source: 'custom', hash, trace: { profileId: profile.identity.id, profileVersion: profile.identity.version, profileHash: hash, source: 'custom', mode: profile.runtime.defaultMode } };
}

export function buildCatalogue(profiles: ResolvedAgentProfile[]): AgentProfileMetadata[] {
  return profiles.map(sanitizeProfileMetadata).sort((a, b) => a.id.localeCompare(b.id));
}
