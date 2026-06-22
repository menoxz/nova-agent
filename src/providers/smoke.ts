#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { DEFAULT_PROVIDER_PROFILE_ID, getProviderProfile, providerDoctor, resolveProviderRuntime, getProviderDirectoryEntry, listProviderDirectory, providerDirectorySummary } from './index.js';
import { listProviderProfiles } from './profiles.js';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;

function runNova(args: string[], env: NodeJS.ProcessEnv = {}, cwd = repoRoot): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', tsxLoader, join(repoRoot, 'src/index.ts'), ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', LLM_PROVIDER: '', LLM_BASE_URL: '', LLM_MODEL: '', NOVA_PROVIDER_PROFILE: '', NOVA_LLM_PROVIDER_PROFILE: '', NOVA_PROVIDER_FALLBACK: '', NOVA_LLM_FALLBACK: '', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function main(): Promise<void> {
  assert.ok(getProviderProfile(DEFAULT_PROVIDER_PROFILE_ID), 'default provider profile exists');
  const profiles = listProviderProfiles();
  const directory = listProviderDirectory();
  assert.ok(directory.length >= 140, 'directory includes all opencode-style providers from the user list');
  assert.equal(new Set(directory.map((provider) => provider.id)).size, directory.length, 'directory ids are unique');
  for (const id of ['opencode-zen', 'github-copilot', 'google', 'vercel-ai-gateway', 'cloudflare-workers-ai', 'amazon-bedrock', 'azure', 'vertex-anthropic', 'openrouter', 'openmodel', 'other-custom-provider']) {
    assert.ok(getProviderDirectoryEntry(id), `directory includes provider: ${id}`);
  }
  const summary = providerDirectorySummary();
  assert.ok(summary['runtime-supported'] >= 5, 'directory classifies runtime-supported providers');
  assert.ok(summary.planned >= 80, 'directory classifies planned providers');
  assert.ok(summary['gateway-subscription-token-plan'] >= 20, 'directory classifies gateway/subscription/token-plan providers');
  assert.ok(summary['custom-other'] >= 2, 'directory classifies custom/other providers');
  assert.ok(profiles.length >= 20, 'catalog includes expanded provider/model profiles');
  assert.equal(new Set(profiles.map((profile) => profile.id)).size, profiles.length, 'profile ids are unique');
  for (const id of ['openrouter-openai-gpt-5', 'openrouter-anthropic-claude-sonnet-4', 'openrouter-google-gemini-3-pro-preview', 'openai-gpt-5-mini', 'anthropic-claude-haiku-4-5', 'deepseek-v4-pro', 'openmodel-kimi-k2-5-free']) {
    assert.ok(getProviderProfile(id), `expanded opencode-inspired profile exists: ${id}`);
  }
  const resolved = resolveProviderRuntime({ env: { LLM_MODEL: 'env-model' }, project: { llm: { providerProfile: 'openmodel-deepseek-v4-flash', fallbackProfiles: ['openai-gpt-4o-mini'] } } });
  assert.equal(resolved.primary.model, 'env-model', 'env model override wins over config profile');
  assert.equal(resolved.fallbackEnabled, true, 'fallback is explicit opt-in');
  const cliResolved = resolveProviderRuntime({ cliProfileId: 'openmodel-deepseek-v4-flash', env: { LLM_MODEL: 'env-model', LLM_BASE_URL: 'not a url' } });
  assert.equal(cliResolved.primary.model, 'deepseek-v4-flash', 'CLI explicit provider profile ignores env model override');
  assert.equal(cliResolved.primary.baseUrl, 'https://api.openmodel.ai/v1', 'CLI explicit provider profile ignores env baseUrl override');
  const unknownFallback = resolveProviderRuntime({ env: { NOVA_PROVIDER_FALLBACK: 'missing-fallback' } });
  assert.ok(unknownFallback.errors.some((error) => /Unknown fallback provider profile: missing-fallback/.test(error)), 'unknown fallback id is reported');
  const repeatedFallback = resolveProviderRuntime({ env: { NOVA_PROVIDER_FALLBACK: DEFAULT_PROVIDER_PROFILE_ID } });
  assert.ok(repeatedFallback.warnings.some((warning) => /repeats primary profile/.test(warning)), 'repeated primary fallback warning is reported');
  const doctor = providerDoctor(resolved, { LLM_API_KEY: 'synthetic-secret-value' });
  assert.equal(doctor.apiKey.status, 'present', 'doctor reports key presence');
  assert.doesNotMatch(JSON.stringify(doctor), /synthetic-secret-value/, 'doctor never prints key value');
  assert.equal(doctor.fallback.automaticSilentFallback, false, 'fallback is not silent/automatic');
  const credentialUrl = providerDoctor(resolveProviderRuntime({ env: { LLM_BASE_URL: 'https://user:password@example.test/v1' } }));
  assert.doesNotMatch(JSON.stringify(credentialUrl), /user:password/, 'doctor redacts credential URLs');
  const invalidUrl = providerDoctor(resolveProviderRuntime({ env: { LLM_BASE_URL: 'https://user:password@' } }));
  assert.doesNotMatch(JSON.stringify(invalidUrl), /user:password/, 'invalid baseUrl display redacts credentials');
  assert.ok(getProviderDirectoryEntry('OpenRouter'), 'directory lookup supports exact name case-insensitively');

  const list = runNova(['providers', 'list']);
  assert.equal(list.status, 0, `providers list exits 0: ${list.stderr}`);
  assert.match(list.stdout, /openrouter-deepseek-v4-flash/, 'providers list includes default profile');
  assert.match(list.stdout, /openrouter-openai-gpt-5/, 'providers list includes expanded profile');
  assert.match(list.stdout, /OpenCode Zen/, 'providers list includes metadata-only directory provider');
  assert.doesNotMatch(list.stderr + list.stdout, /LLM_API_KEY not set/, 'providers list does not require LLM_API_KEY');

  const show = runNova(['providers', 'show', 'openmodel-deepseek-v4-flash']);
  assert.equal(show.status, 0, `providers show exits 0: ${show.stderr}`);
  assert.match(show.stdout, /anthropic-messages/, 'providers show includes protocol');
  const showPlanned = runNova(['providers', 'show', 'github-copilot']);
  assert.equal(showPlanned.status, 0, `providers show planned exits 0: ${showPlanned.stderr}`);
  assert.match(showPlanned.stdout, /gateway-subscription-token-plan/, 'planned/gateway provider classification shown');
  assert.match(showPlanned.stdout, /"runtimeExecutable": false/, 'planned provider is not claimed executable');

  const invalidConfigRoot = await mkdtemp(join(tmpdir(), 'nova-providers-invalid-config-'));
  try {
    await mkdir(join(invalidConfigRoot, '.nova'), { recursive: true });
    await writeFile(join(invalidConfigRoot, '.nova', 'config.json'), '{"schemaVersion":1,"unknown":true}\n', 'utf-8');
    const listWithInvalidConfig = runNova(['providers', 'list'], {}, invalidConfigRoot);
    assert.equal(listWithInvalidConfig.status, 0, `providers list ignores invalid project config: ${listWithInvalidConfig.stderr}`);
    assert.match(listWithInvalidConfig.stdout, /openrouter-deepseek-v4-flash/, 'providers list from temp cwd still reads catalog');
    assert.doesNotMatch(listWithInvalidConfig.stderr + listWithInvalidConfig.stdout, /Invalid Nova project config|LLM_API_KEY not set/, 'providers list does not validate config or require key');
    const showWithInvalidConfig = runNova(['providers', 'show', 'openmodel'], {}, invalidConfigRoot);
    assert.equal(showWithInvalidConfig.status, 0, `providers show ignores invalid project config: ${showWithInvalidConfig.stderr}`);
    assert.match(showWithInvalidConfig.stdout, /OpenModel/, 'providers show from temp cwd still reads directory entry');
    assert.doesNotMatch(showWithInvalidConfig.stderr + showWithInvalidConfig.stdout, /Invalid Nova project config|LLM_API_KEY not set/, 'providers show does not validate config or require key');
  } finally {
    await rm(invalidConfigRoot, { recursive: true, force: true });
  }

  const cliDoctor = runNova(['--provider-profile', 'openmodel-deepseek-v4-flash', 'providers', 'doctor'], { LLM_API_KEY: 'synthetic-secret-value' });
  assert.equal(cliDoctor.status, 0, `providers doctor exits 0: ${cliDoctor.stderr}`);
  assert.match(cliDoctor.stdout, /"status": "present"/, 'doctor reports key present');
  assert.doesNotMatch(cliDoctor.stdout + cliDoctor.stderr, /synthetic-secret-value/, 'doctor output excludes key value');
  assert.doesNotMatch(cliDoctor.stdout + cliDoctor.stderr, /LLM_API_KEY not set/, 'doctor does not reach LLM key check');

  const cliIgnoresEnvModel = runNova(['--provider-profile', 'openmodel-deepseek-v4-flash', 'providers', 'doctor'], { LLM_MODEL: 'env-model-should-not-win' });
  assert.equal(cliIgnoresEnvModel.status, 0, `CLI profile doctor exits 0: ${cliIgnoresEnvModel.stderr}`);
  assert.match(cliIgnoresEnvModel.stdout, /"model": "deepseek-v4-flash"/, 'CLI explicit profile keeps profile model');
  assert.doesNotMatch(cliIgnoresEnvModel.stdout, /env-model-should-not-win/, 'CLI explicit profile ignores env model in display');

  const unknown = runNova(['--provider-profile', 'missing-profile', 'providers', 'doctor']);
  assert.equal(unknown.status, 1, 'unknown provider profile exits 1 in doctor');
  assert.match(unknown.stdout, /Unknown provider profile/, 'unknown profile is explained');

  console.log('providers:smoke passed');
}

main().catch((err) => {
  console.error('providers:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
