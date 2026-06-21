import { stat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPathInside } from '../utils/safe_io.js';

export const LSP_VERSION = '0.1.0';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_OUTPUT_MAX_CHARS = 20_000;
export const HARD_OUTPUT_MAX_CHARS = 80_000;
export const MAX_METADATA_FILE_BYTES = 512 * 1024;

export const DENIED_MESSAGE = 'Access denied by Nova LSP read-only security policy.';

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/gi,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /((?:api[_-]?key|authorization|password|passwd|secret|token|credential)\s*[:=]\s*)([^\s'\"]+)/gi,
];

export type PolicyCheck = { ok: true; path: string } | { ok: false; reason: string };

export function allowedRoots(): string[] {
  const extra = (process.env.NOVA_LSP_ALLOWED_ROOTS ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [PROJECT_ROOT, ...extra].map((entry) => resolve(entry));
}

export function normalizeForPolicy(path: string): string {
  return path.replace(/\\/g, '/');
}

export function hasTraversal(input: string): boolean {
  return input.split(/[\\/]+/).some((part) => part === '..');
}

export function deniedReason(path: string): string | undefined {
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

export function resolvePolicyPath(inputPath: string, label = 'path'): PolicyCheck {
  if (!inputPath.trim()) return { ok: false, reason: `${label} is required` };
  if (inputPath.includes('\0')) return { ok: false, reason: `${label} contains a NUL byte` };
  if (hasTraversal(inputPath)) return { ok: false, reason: `${label} must not contain .. path traversal segments` };
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(PROJECT_ROOT, inputPath);
  if (!allowedRoots().some((root) => isPathInside(resolved, root))) return { ok: false, reason: `${label} is outside configured allowed roots` };
  const reason = deniedReason(resolved);
  if (reason) return { ok: false, reason };
  return { ok: true, path: resolved };
}

export function safeRelative(path: string): string {
  const root = allowedRoots().find((candidate) => isPathInside(path, candidate)) ?? PROJECT_ROOT;
  return relative(root, path) || '.';
}

export function redactText(text: string): string {
  let safe = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    safe = safe.replace(pattern, (...args) => {
      if (args.length > 3 && typeof args[1] === 'string') return `${args[1]}<redacted>`;
      return '<redacted>';
    });
  }
  return safe;
}

export function containsPrivateKeyMaterial(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----/i.test(text);
}

export function capText(text: string, maxChars = DEFAULT_OUTPUT_MAX_CHARS): { text: string; truncated: boolean; originalChars: number; maxChars: number } {
  const bounded = Math.max(1_000, Math.min(HARD_OUTPUT_MAX_CHARS, maxChars));
  const originalChars = text.length;
  if (originalChars <= bounded) return { text, truncated: false, originalChars, maxChars: bounded };
  return { text: `${text.slice(0, bounded)}\n...(truncated ${originalChars - bounded} chars)`, truncated: true, originalChars, maxChars: bounded };
}

export function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redactText(message.replace(/\r?\n[\s\S]*/m, ''));
}

export async function readSafeTextFile(path: string): Promise<string | undefined> {
  const check = resolvePolicyPath(path, 'metadata path');
  if (!check.ok) return undefined;
  const info = await stat(check.path).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_METADATA_FILE_BYTES) return undefined;
  const raw = await readFile(check.path);
  if (raw.includes(0)) return undefined;
  const text = raw.toString('utf-8');
  if (containsPrivateKeyMaterial(text)) return undefined;
  return capText(redactText(text)).text;
}
