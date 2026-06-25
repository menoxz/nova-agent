#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { builtInProfiles } from './defaults.js';
import { hashProfile } from './hash.js';
import { loadCustomProfiles } from './loader.js';
import { effectiveAllowedTools } from './merge.js';
import { resolveProfileSync, applyProfileToConfig } from './resolver.js';
import { exportProfileToFile, importProfileFromFile } from './import_export.js';
import { validateProfile } from './validate.js';
import { containsSecretLikeMaterial } from './security.js';
import { builtInProfileCatalogue, doctorProfile, findBuiltInProfileMetadata } from './index.js';
import { getPolicyProfile } from '../policy/profiles.js';
import type { AgentConfig } from '../types.js';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

async function main(): Promise<void> {
  assert.equal(builtInProfiles.length, 9, 'all V1 built-ins are present');
  assert.equal(builtInProfileCatalogue().length, 9, 'catalogue exposes all built-ins as metadata');
  assert.equal(findBuiltInProfileMetadata('nova.security')?.policyProfileId, 'readonly', 'metadata lookup redacts to safe fields');
  const ids = builtInProfiles.map((profile) => profile.identity.id);
  for (const id of ['nova.general', 'nova.researcher', 'nova.architect', 'nova.builder', 'nova.security', 'nova.qa', 'nova.docs', 'nova.refactor', 'nova.product']) assert(ids.includes(id), `${id} exists`);
  for (const profile of builtInProfiles) {
    const result = validateProfile(profile);
    assert.equal(result.ok, true, `${profile.identity.id} validates: ${result.errors.join('; ')}`);
    assert.equal(hashProfile(profile), hashProfile(clone(profile)), `${profile.identity.id} hash is stable`);
    assert(!profile.tools.allowed.includes('write_file') && !profile.tools.allowed.includes('bash'), `${profile.identity.id} does not allow write/shell by default`);
    assert.equal(doctorProfile(resolveProfileSync({ profileId: profile.identity.id })).ok, true, `${profile.identity.id} doctor passes`);
    getPolicyProfile(profile.policy.profileId);
  }
  const badPolicy = clone(builtInProfiles[0]);
  badPolicy.policy.profileId = 'missing-policy';
  assert(validateProfile(badPolicy).errors.some((error) => error.includes('Unknown policy profile')), 'unknown policy profile fails');
  const badSecret = clone(builtInProfiles[0]) as any;
  badSecret.apiKey = 'sk-1234567890abcdef1234567890abcdef';
  assert(containsSecretLikeMaterial(badSecret), 'secret-like profile rejected');
  assert.equal(doctorProfile(badSecret).safety.secretLikeMaterial, true, 'doctor reports secret-like profile material');
  const denyWins = clone(builtInProfiles[0]);
  denyWins.tools.allowed.push('bash');
  denyWins.tools.denied.push('bash');
  assert(!effectiveAllowedTools(denyWins).includes('bash'), 'tool deny wins over allow');
  assert(resolveProfileSync({ profileId: 'nova.qa' }).subagent.compatibleRoles.includes('qa'), 'subagent role compatibility is represented');
  const baseConfig: AgentConfig = { llm: { provider: 'mock', baseUrl: '', apiKey: '', model: 'mock' }, systemPrompt: 'base' };
  const resolvedConfig = applyProfileToConfig(baseConfig, resolveProfileSync({ profileId: 'nova.builder' }));
  assert.equal(resolvedConfig.profile?.id, 'nova.builder', 'resolved AgentConfig has profile metadata');
  assert.equal(resolvedConfig.policy?.profileId, 'developer', 'resolved AgentConfig applies profile policy');
  assert.equal(resolvedConfig.profile?.policyProfileId, 'developer', 'resolved AgentConfig surfaces effective policy profile');
  assert.equal(resolvedConfig.trace?.profile?.profileId, 'nova.builder', 'trace profile metadata present');
  const policyOverrideAttempt = applyProfileToConfig({ ...baseConfig, policy: { profileId: 'trusted-local' } }, resolveProfileSync({ profileId: 'nova.qa' }));
  assert.equal(policyOverrideAttempt.policy?.profileId, 'ci-eval', 'selected profile policy wins by default');
  const policyOverrideAllowed = applyProfileToConfig({ ...baseConfig, policy: { profileId: 'trusted-local', allowProfilePolicyOverride: true } }, resolveProfileSync({ profileId: 'nova.qa' }));
  assert.equal(policyOverrideAllowed.policy?.profileId, 'trusted-local', 'explicit profile policy override permission is required');
  const maxStepsOverrideAttempt = applyProfileToConfig({ ...baseConfig, maxSteps: 99 }, resolveProfileSync({ profileId: 'nova.researcher' }));
  assert.equal(maxStepsOverrideAttempt.maxSteps, 18, 'V1 does not apply runtime maxSteps overrides');
  const tmp = await mkdtemp(join(tmpdir(), 'nova-profiles-smoke-'));
  try {
    const customDir = join(tmp, '.nova', 'profiles', 'custom');
    await writeFile(join(tmp, 'placeholder'), 'x');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'bad.json'), JSON.stringify(badSecret), 'utf-8');
    await assert.rejects(() => loadCustomProfiles(tmp), /secret-like/i, 'custom profile loader rejects secrets');
    await exportProfileToFile(clone(builtInProfiles[0]), 'safe.json', { rootDir: customDir });
    assert.equal((await importProfileFromFile('safe.json', { rootDir: customDir })).identity.id, 'nova.general', 'bounded import accepts in-root profile');
    assert((await readFile(join(customDir, 'safe.json'), 'utf-8')).includes('nova.general'), 'bounded export writes in-root profile');
    await assert.rejects(() => importProfileFromFile('../outside.json', { rootDir: customDir }), /must stay under/i, 'import rejects traversal outside root');
    await assert.rejects(() => exportProfileToFile(clone(builtInProfiles[0]), resolve(tmp, 'outside.json'), { rootDir: customDir }), /must stay under/i, 'export rejects outside-root absolute path');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  console.log('profiles smoke passed');
}

main().catch((err) => {
  console.error('profiles smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
