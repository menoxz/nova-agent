#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builtEntry = join(root, 'dist', 'index.js');
const sourceEntry = join(root, 'src', 'index.ts');

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
