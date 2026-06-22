#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { defaultProjectConfig, explainProjectConfig, initProjectConfig, mergeProjectConfig, projectConfigPath, readProjectConfig, sanitizeConfigForDisplay } from './project.js';
import type { AgentConfig } from '../types.js';

const SYNTHETIC_HEARTBEAT_SECRET = 'sk-configHeartbeatToken1234567890';
const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve('tsx')).href;

function runNova(args: string[], cwd: string) {
  return spawnSync(process.execPath, ['--import', tsxLoader, join(repoRoot, 'src/index.ts'), ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '', NOVA_ENABLE_WRITE_TOOLS: '' },
  });
}

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

    const cliValidate = runNova(['config', 'validate'], root);
    assert.equal(cliValidate.status, 0, `config validate exits 0: ${cliValidate.stderr}`);
    assert.match(cliValidate.stdout ?? '', /"ok": true/, 'config validate prints ok true');
    const cliShow = runNova(['config', 'show'], root);
    assert.equal(cliShow.status, 0, `config show exits 0: ${cliShow.stderr}`);
    assert.match(cliShow.stdout ?? '', /"runtime"/, 'config show prints sanitized runtime');
    assert.doesNotMatch((cliShow.stdout ?? '') + (cliShow.stderr ?? ''), /LLM_API_KEY not set/, 'config show does not require LLM key');
    const cliExplain = runNova(['config', 'explain'], root);
    assert.equal(cliExplain.status, 0, `config explain exits 0: ${cliExplain.stderr}`);
    assert.match(cliExplain.stdout ?? '', /Precedence/, 'config explain prints precedence');

    await writeFile(projectConfigPath(root), '{"schemaVersion":1,"unknown":true}\n', 'utf-8');
    const unknownField = readProjectConfig(root);
    assert.equal(unknownField.ok, false, 'strict schema rejects unknown root fields');
    assert.ok(unknownField.errors.some((error) => /Unrecognized key/.test(error)), 'unknown field rejection is explained');

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

    await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: 1, heartbeat: { tasks: [{ id: 'interval-missing', kind: 'inspection', action: 'inspect', schedule: { type: 'interval' } }] } }), 'utf-8');
    const intervalMissing = readProjectConfig(root);
    assert.equal(intervalMissing.ok, false, 'interval schedule without everyMinutes rejected');
    assert.ok(intervalMissing.errors.some((error) => /interval schedule requires everyMinutes/.test(error)), 'interval schedule error explained');

    await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: 1, heartbeat: { tasks: [{ id: 'manual-with-every', kind: 'inspection', action: 'inspect', schedule: { type: 'manual', everyMinutes: 5 } }] } }), 'utf-8');
    const manualEvery = readProjectConfig(root);
    assert.equal(manualEvery.ok, false, 'manual schedule with everyMinutes rejected');
    assert.ok(manualEvery.errors.some((error) => /manual schedule must not set everyMinutes/.test(error)), 'manual schedule edge error explained');

    await writeFile(projectConfigPath(root), JSON.stringify({ schemaVersion: 1, heartbeat: { tasks: [{ id: 'interval-too-large', kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 525_601 } }] } }), 'utf-8');
    const intervalLarge = readProjectConfig(root);
    assert.equal(intervalLarge.ok, false, 'heartbeat interval maximum is enforced');

    console.log('config:smoke passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('config:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
