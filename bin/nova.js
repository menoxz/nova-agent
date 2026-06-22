#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtEntry = join(root, 'dist', 'index.js');
const sourceEntry = join(root, 'src', 'index.ts');

if (['--version', '-v', 'version'].includes(process.argv[2] ?? '')) {
  try {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    console.log(`${packageJson.name ?? 'nova-agent'} ${packageJson.version ?? '0.0.0-unknown'}`);
  } catch {
    console.log('nova-agent 0.0.0-unknown');
  }
  process.exit(0);
}

if (existsSync(builtEntry)) {
  await import(pathToFileURL(builtEntry).href);
} else {
  const result = spawnSync(process.execPath, ['--import', 'tsx', sourceEntry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (typeof result.status === 'number') process.exit(result.status);
  if (result.signal) {
    console.error(`nova: fallback tsx process terminated by ${result.signal}`);
    process.exit(1);
  }
  process.exit(0);
}
