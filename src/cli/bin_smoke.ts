#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(command: string, args: string[], cwd = process.cwd(), shell = false) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, LLM_API_KEY: '' },
    shell,
  });
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
  const direct = run(process.execPath, ['bin/nova.js', '--help']);
  assert.equal(direct.status, 0, `direct bin help exits 0: ${direct.stderr}`);
  assert.match(direct.stdout ?? '', /Nova Agent — CLI/, 'direct bin renders global help');
  assert.doesNotMatch((direct.stderr ?? '') + (direct.stdout ?? ''), /LLM_API_KEY not set/, 'direct bin help does not require LLM key');
  const directVersion = run(process.execPath, ['bin/nova.js', '--version']);
  assert.equal(directVersion.status, 0, `direct bin version exits 0: ${directVersion.stderr}`);
  assert.equal((directVersion.stdout ?? '').trim(), `nova-agent ${packageJson.version}`, 'direct bin prints package version');
  assert.doesNotMatch((directVersion.stderr ?? '') + (directVersion.stdout ?? ''), /LLM_API_KEY not set/, 'direct bin version does not require LLM key');

  const build = run('npm', ['run', 'build'], process.cwd(), process.platform === 'win32');
  assert.equal(build.status, 0, `npm run build exits 0: ${build.stderr}`);
  const built = run(process.execPath, ['bin/nova.js', 'tui', '--help']);
  assert.equal(built.status, 0, `built bin help exits 0: ${built.stderr}`);
  assert.match(built.stdout ?? '', /nova tui replay <logId>/, 'built bin loads dist entry');
  const builtGlobalHelp = run(process.execPath, ['bin/nova.js', '--help']);
  assert.equal(builtGlobalHelp.status, 0, `built bin global help exits 0: ${builtGlobalHelp.stderr}`);
  assert.match(builtGlobalHelp.stdout ?? '', new RegExp(`Nova Agent .*v${packageJson.version}`), 'built bin help shows package version');
  assert.match(builtGlobalHelp.stdout ?? '', /--version, -v/, 'built bin help documents version flag');
  const builtVersion = run(process.execPath, ['bin/nova.js', 'version']);
  assert.equal(builtVersion.status, 0, `built bin version exits 0: ${builtVersion.stderr}`);
  assert.equal((builtVersion.stdout ?? '').trim(), `nova-agent ${packageJson.version}`, 'built bin prints package version');

  const root = await mkdtemp(join(tmpdir(), 'nova-bin-smoke-'));
  try {
    const link = run('npm', ['link', process.cwd()], root, process.platform === 'win32');
    assert.equal(link.status, 0, `npm link install exits 0: ${link.stderr}`);
    const linked = run('nova', ['--help'], root, process.platform === 'win32');
    assert.equal(linked.status, 0, `linked nova --help exits 0: ${linked.stderr}`);
    assert.match(linked.stdout ?? '', /Nova Agent — CLI/, 'linked nova renders help');
    assert.doesNotMatch((linked.stderr ?? '') + (linked.stdout ?? ''), /LLM_API_KEY not set/, 'linked nova help does not require LLM key');
    const linkedVersion = run('nova', ['--version'], root, process.platform === 'win32');
    assert.equal(linkedVersion.status, 0, `linked nova --version exits 0: ${linkedVersion.stderr}`);
    assert.equal((linkedVersion.stdout ?? '').trim(), `nova-agent ${packageJson.version}`, 'linked nova prints package version');
    assert.doesNotMatch((linkedVersion.stderr ?? '') + (linkedVersion.stdout ?? ''), /LLM_API_KEY not set/, 'linked nova version does not require LLM key');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log('bin:smoke passed');
}

main().catch((err) => {
  console.error('bin:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
