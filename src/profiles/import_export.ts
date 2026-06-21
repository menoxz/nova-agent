import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { assertPathUnderDir, readJsonFileBounded } from '../utils/safe_io.js';
import { customProfilesDir } from './loader.js';
import { assertNoProfileSecrets } from './security.js';
import { assertValidProfile } from './validate.js';
import { migrateProfile } from './migrations.js';
import type { AgentProfile } from './types.js';

export interface ProfileFileOptions {
  rootDir?: string;
}

function resolveProfileFilePath(path: string, options: ProfileFileOptions | undefined, label: string): string {
  const root = resolve(options?.rootDir ?? customProfilesDir());
  const candidate = isAbsolute(path) ? path : resolve(root, path);
  return assertPathUnderDir(candidate, root, label);
}

export async function importProfileFromFile(path: string, options?: ProfileFileOptions): Promise<AgentProfile> {
  const resolvedPath = resolveProfileFilePath(path, options, 'Profile import path');
  const raw = await readJsonFileBounded(resolvedPath, 'Profile import file');
  assertNoProfileSecrets(raw, resolvedPath);
  return assertValidProfile(migrateProfile(raw));
}

export async function exportProfileToFile(profile: AgentProfile, path: string, options?: ProfileFileOptions): Promise<void> {
  const resolvedPath = resolveProfileFilePath(path, options, 'Profile export path');
  assertNoProfileSecrets(profile, profile.identity.id);
  const valid = assertValidProfile(profile);
  await writeFile(resolvedPath, `${JSON.stringify(valid, null, 2)}\n`, 'utf-8');
}
