#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const REQUIRED_ENTRIES = [
  'dist/index.js',
  'bin/nova.js',
  'bin/nova-mcp.js',
  'scripts/assert-release-readiness.mjs',
  'docs/packaging-install.md',
  'docs/mcp/BACKLOG_V1_1.md',
  'docs/mcp/CLIENT_SETUP.md',
  'docs/mcp/README.md',
  'docs/mcp/RESOURCES.md',
  'docs/mcp/SECURITY.md',
  'docs/mcp/TOOLS.md',
  'docs/release-candidate-dry-run-checklist.md',
];

function npmPackCommand() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['pack', '--dry-run', '--ignore-scripts', '--json'],
  };
}

function normalizePackPath(path) {
  return path.replaceAll('\\', '/').replace(/^package\//, '');
}

function forbiddenReason(path) {
  const lower = path.toLowerCase();

  if (lower === '.env' || lower.startsWith('.env.')) {
    return 'environment file';
  }

  for (const directory of ['.nova', 'node_modules', 'tmp', '.vscode', 'src']) {
    if (lower === directory || lower.startsWith(`${directory}/`)) {
      return `forbidden directory: ${directory}`;
    }
  }

  if (lower.includes('smoke') && !lower.startsWith('docs/')) {
    return 'smoke artifact outside docs';
  }

  return null;
}

function readPackManifest() {
  const { command, args } = npmPackCommand();
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const manifest = JSON.parse(output);
  const firstPackage = manifest[0];

  if (!firstPackage || !Array.isArray(firstPackage.files)) {
    throw new Error('npm pack dry-run JSON did not include a files list.');
  }

  return firstPackage.files.map((file) => normalizePackPath(file.path));
}

function assertReleaseReadiness(paths) {
  const pathSet = new Set(paths);
  const missing = REQUIRED_ENTRIES.filter((entry) => !pathSet.has(entry));
  const forbidden = paths
    .map((path) => ({ path, reason: forbiddenReason(path) }))
    .filter((entry) => entry.reason !== null);

  if (missing.length > 0 || forbidden.length > 0) {
    if (missing.length > 0) {
      console.error('Release readiness failed: missing required package entries:');
      for (const entry of missing) {
        console.error(`- ${entry}`);
      }
    }

    if (forbidden.length > 0) {
      console.error('Release readiness failed: forbidden package entries detected:');
      for (const { path, reason } of forbidden) {
        console.error(`- ${path} (${reason})`);
      }
    }

    process.exitCode = 1;
    return;
  }

  console.log(`Release readiness manifest check passed (${paths.length} package entries).`);
  console.log(`Required entries: ${REQUIRED_ENTRIES.join(', ')}`);
}

try {
  assertReleaseReadiness(readPackManifest());
} catch (error) {
  console.error(`Release readiness failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
