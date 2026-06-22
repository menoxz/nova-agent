#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { DEFAULT_PROVIDER_PROFILE_ID, getProviderProfile, providerDoctor, resolveProviderRuntime } from './index.js';
import { listProviderProfiles } from './profiles.js';

function runNova(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', LLM_PROVIDER: '', LLM_BASE_URL: '', LLM_MODEL: '', NOVA_PROVIDER_PROFILE: '', NOVA_LLM_PROVIDER_PROFILE: '', NOVA_PROVIDER_FALLBACK: '', NOVA_LLM_FALLBACK: '', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function main(): Promise<void> {
  assert.ok(getProviderProfile(DEFAULT_PROVIDER_PROFILE_ID), 'default provider profile exists');
  const profiles = listProviderProfiles();
  assert.ok(profiles.length >= 20, 'catalog includes expanded provider/model profiles');
  assert.equal(new Set(profiles.map((profile) => profile.id)).size, profiles.length, 'profile ids are unique');
  for (const id of ['openrouter-openai-gpt-5', 'openrouter-anthropic-claude-sonnet-4', 'openrouter-google-gemini-3-pro-preview', 'openai-gpt-5-mini', 'anthropic-claude-haiku-4-5', 'deepseek-v4-pro', 'openmodel-kimi-k2-5-free']) {
    assert.ok(getProviderProfile(id), `expanded opencode-inspired profile exists: ${id}`);
  }
  const resolved = resolveProviderRuntime({ env: { LLM_MODEL: 'env-model' }, project: { llm: { providerProfile: 'openmodel-deepseek-v4-flash', fallbackProfiles: ['openai-gpt-4o-mini'] } } });
  assert.equal(resolved.primary.model, 'env-model', 'env model override wins over config profile');
  assert.equal(resolved.fallbackEnabled, true, 'fallback is explicit opt-in');
  const doctor = providerDoctor(resolved, { LLM_API_KEY: 'synthetic-secret-value' });
  assert.equal(doctor.apiKey.status, 'present', 'doctor reports key presence');
  assert.doesNotMatch(JSON.stringify(doctor), /synthetic-secret-value/, 'doctor never prints key value');
  assert.equal(doctor.fallback.automaticSilentFallback, false, 'fallback is not silent/automatic');
  const credentialUrl = providerDoctor(resolveProviderRuntime({ env: { LLM_BASE_URL: 'https://user:password@example.test/v1' } }));
  assert.doesNotMatch(JSON.stringify(credentialUrl), /user:password/, 'doctor redacts credential URLs');

  const list = runNova(['providers', 'list']);
  assert.equal(list.status, 0, `providers list exits 0: ${list.stderr}`);
  assert.match(list.stdout, /openrouter-deepseek-v4-flash/, 'providers list includes default profile');
  assert.match(list.stdout, /openrouter-openai-gpt-5/, 'providers list includes expanded profile');
  assert.doesNotMatch(list.stderr + list.stdout, /LLM_API_KEY not set/, 'providers list does not require LLM_API_KEY');

  const show = runNova(['providers', 'show', 'openmodel-deepseek-v4-flash']);
  assert.equal(show.status, 0, `providers show exits 0: ${show.stderr}`);
  assert.match(show.stdout, /anthropic-messages/, 'providers show includes protocol');

  const cliDoctor = runNova(['--provider-profile', 'openmodel-deepseek-v4-flash', 'providers', 'doctor'], { LLM_API_KEY: 'synthetic-secret-value' });
  assert.equal(cliDoctor.status, 0, `providers doctor exits 0: ${cliDoctor.stderr}`);
  assert.match(cliDoctor.stdout, /"status": "present"/, 'doctor reports key present');
  assert.doesNotMatch(cliDoctor.stdout + cliDoctor.stderr, /synthetic-secret-value/, 'doctor output excludes key value');
  assert.doesNotMatch(cliDoctor.stdout + cliDoctor.stderr, /LLM_API_KEY not set/, 'doctor does not reach LLM key check');

  const unknown = runNova(['--provider-profile', 'missing-profile', 'providers', 'doctor']);
  assert.equal(unknown.status, 1, 'unknown provider profile exits 1 in doctor');
  assert.match(unknown.stdout, /Unknown provider profile/, 'unknown profile is explained');

  console.log('providers:smoke passed');
}

main().catch((err) => {
  console.error('providers:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
