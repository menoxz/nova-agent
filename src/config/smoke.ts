#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

import { defaultProjectConfig, explainProjectConfig, initProjectConfig, mergeProjectConfig, projectConfigPath, readProjectConfig, sanitizeConfigForDisplay } from './project.js';
import type { AgentConfig } from '../types.js';

const SYNTHETIC_HEARTBEAT_SECRET = 'sk-configHeartbeatToken1234567890';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-config-smoke-'));
  try {
    const missing = readProjectConfig(root);
    assert.equal(missing.present, false, 'missing config is okay');
    assert.equal(missing.ok, true, 'missing config does not fail runtime');

    const initialized = initProjectConfig(root);
    assert.equal(initialized.ok, true, 'init writes valid config');
    assert.equal(initialized.config?.schemaVersion, 1, 'schema version set');

    const refused = initProjectConfig(root);
    assert.equal(refused.ok, false, 'init refuses overwrite by default');
    assert.match(refused.errors[0] ?? '', /refusing to overwrite/, 'overwrite refusal explained');

    const loaded = readProjectConfig(root);
    assert.equal(loaded.ok, true, 'read validates config');
    assert.ok(explainProjectConfig(loaded.config).some((line) => line.includes('secrets/API keys')), 'explain mentions secret handling');

    const base: AgentConfig = {
      llm: { provider: 'env-provider', baseUrl: 'https://example.test/v1', apiKey: 'real-env-key', model: 'env-model', pricing: { currency: 'USD' } },
      systemPrompt: 'Nova',
      session: { enabled: false, defaultBudget: { maxToolCalls: 1, currency: 'USD' } },
      context: { enabled: false },
      policy: { enabled: true, profileId: 'readonly' },
    };
    const merged = mergeProjectConfig(base, { ...defaultProjectConfig(), llm: { providerProfile: 'openmodel-deepseek-v4-flash', fallbackProfiles: ['openai-gpt-4o-mini'] }, session: { enabled: true, title: 'Project title' }, runs: { maxToolCalls: 20, currency: 'EUR' } });
    assert.equal(merged.llm.providerProfile, 'openmodel-deepseek-v4-flash', 'project provider profile merged');
    assert.deepEqual(merged.llm.fallbackProfiles, ['openai-gpt-4o-mini'], 'project fallback profiles merged');
    assert.equal(merged.llm.apiKey, 'real-env-key', 'project config never supplies api key');
    assert.equal(merged.session?.enabled, true, 'project session default merged');
    assert.equal(merged.session?.defaultBudget?.maxToolCalls, 20, 'run budget merged');
    assert.equal(merged.streaming?.enabled, true, 'streaming defaults merge from project config');
    assert.equal(merged.streaming?.mode, 'normal', 'streaming mode defaults to normal');
    assert.equal(merged.streaming?.thinkingMode, 'collapsed', 'streaming thinking defaults are safe/collapsed');
    assert.equal(merged.streaming?.eventLog?.enabled, false, 'streaming event log is opt-in by default');
    assert.equal(sanitizeConfigForDisplay(merged).llm.apiKey, '[REDACTED:env]', 'display redacts env key');

    await writeFile(projectConfigPath(root), '{"schemaVersion":1,"llm":{"apiKey":"sk-12345678901234567890"}}\n', 'utf-8');
    const secret = readProjectConfig(root);
    assert.equal(secret.ok, false, 'secret-like config rejected');
    assert.ok(secret.errors.some((error) => /secret/i.test(error)), 'secret rejection explained');

    await writeFile(projectConfigPath(root), JSON.stringify({
      schemaVersion: 1,
      heartbeat: {
        enabled: true,
        tasks: [{ id: SYNTHETIC_HEARTBEAT_SECRET, kind: 'inspection', action: 'inspect', schedule: { type: 'manual' } }],
      },
    }, null, 2), 'utf-8');
    const heartbeatSecret = readProjectConfig(root);
    assert.equal(heartbeatSecret.ok, false, 'secret-like heartbeat config rejected');
    assert.ok(heartbeatSecret.errors.some((error) => /heartbeat\.tasks\.0\.id: secret-like value is not allowed/.test(error)), 'heartbeat secret path is explained without raw value');
    assert.doesNotMatch(heartbeatSecret.errors.join('\n'), new RegExp(SYNTHETIC_HEARTBEAT_SECRET, 'g'), 'heartbeat secret value is not echoed');

    console.log('config:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('config:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
