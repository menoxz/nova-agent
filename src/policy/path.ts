import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPathInside } from '../utils/safe_io.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type PolicyPathCheck = { ok: true; path: string; safePath: string } | { ok: false; reason: string; safePath?: string };

export function splitRootsEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function allowedRoots(extraRoots: string[] = []): string[] {
  return [PROJECT_ROOT, ...splitRootsEnv(process.env.NOVA_POLICY_ALLOWED_ROOTS), ...extraRoots].map((entry) => resolve(entry));
}

export function normalizeForPolicy(path: string): string {
  return path.replace(/\\/g, '/');
}

export function hasTraversal(input: string): boolean {
  return input.split(/[\\/]+/).some((part) => part === '..');
}

export function deniedPathReason(path: string): string | undefined {
  const normalized = normalizeForPolicy(path);
  const parts = normalized.split('/').filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const base = parts.at(-1) ?? '';
  const lowerBase = base.toLowerCase();

  if (lowerBase === '.env' || lowerBase.startsWith('.env.')) return '.env files are denied';
  if (lowerParts.includes('.git')) return '.git internals are denied';
  if (lowerParts.includes('node_modules')) return 'node_modules is denied';
  if (/\.(pem|key|p12|pfx|ppk|asc|gpg)$/i.test(lowerBase)) return 'private key material extensions are denied';
  if (/(^|[._-])(secret|token|credential|credentials|api[_-]?key|private[_-]?key|password|passwd)([._-]|$)/i.test(base)) {
    return 'secret/token/credential-like filenames are denied';
  }
  const novaIdx = lowerParts.indexOf('.nova');
  if (novaIdx >= 0) {
    const next = lowerParts[novaIdx + 1];
    if (next === 'traces' || next === 'reports' || next === 'evals') return `.nova/${next} raw artifacts are denied`;
  }
  return undefined;
}

export function safeRelative(path: string, roots = allowedRoots()): string {
  const root = roots.find((candidate) => isPathInside(resolve(path), candidate)) ?? PROJECT_ROOT;
  return relative(root, resolve(path)) || '.';
}

export function resolvePolicyPath(inputPath: string, label = 'path', roots = allowedRoots()): PolicyPathCheck {
  if (!inputPath || !inputPath.trim()) return { ok: false, reason: `${label} is required` };
  if (inputPath.includes('\0')) return { ok: false, reason: `${label} contains a NUL byte` };
  if (hasTraversal(inputPath)) return { ok: false, reason: `${label} must not contain .. path traversal segments` };
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(PROJECT_ROOT, inputPath);
  if (!roots.some((root) => isPathInside(resolved, root))) return { ok: false, reason: `${label} is outside configured allowed roots` };
  const reason = deniedPathReason(resolved);
  if (reason) return { ok: false, reason, safePath: safeRelative(resolved, roots) };
  return { ok: true, path: resolved, safePath: safeRelative(resolved, roots) };
}
