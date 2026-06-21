import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  PROJECT_ROOT,
  capText as sharedCapText,
  containsPrivateKeyMaterial,
  deniedPathReason,
  redactString,
  resolvePolicyPath as resolveSharedPolicyPath,
  safeRelative as sharedSafeRelative,
  splitRootsEnv,
} from '../policy/index.js';

export { containsPrivateKeyMaterial, hasTraversal, normalizeForPolicy } from '../policy/index.js';
export { PROJECT_ROOT } from '../policy/index.js';

export const LSP_VERSION = '0.1.0';
export const DEFAULT_OUTPUT_MAX_CHARS = 20_000;
export const HARD_OUTPUT_MAX_CHARS = 80_000;
export const MAX_METADATA_FILE_BYTES = 512 * 1024;

export const DENIED_MESSAGE = 'Access denied by Nova LSP read-only security policy.';

export type PolicyCheck = { ok: true; path: string } | { ok: false; reason: string };

export function allowedRoots(): string[] {
  const extra = splitRootsEnv(process.env.NOVA_LSP_ALLOWED_ROOTS);
  return [PROJECT_ROOT, ...extra].map((entry) => resolve(entry));
}

export function deniedReason(path: string): string | undefined {
  return deniedPathReason(path);
}

export function resolvePolicyPath(inputPath: string, label = 'path'): PolicyCheck {
  const check = resolveSharedPolicyPath(inputPath, label, allowedRoots());
  return check.ok ? { ok: true, path: check.path } : { ok: false, reason: check.reason };
}

export function safeRelative(path: string): string {
  return sharedSafeRelative(path, allowedRoots());
}

export function redactText(text: string): string {
  return redactString(text, HARD_OUTPUT_MAX_CHARS);
}

export function capText(text: string, maxChars = DEFAULT_OUTPUT_MAX_CHARS): { text: string; truncated: boolean; originalChars: number; maxChars: number } {
  return sharedCapText(text, Math.min(HARD_OUTPUT_MAX_CHARS, maxChars));
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
