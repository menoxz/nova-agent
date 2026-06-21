import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertPathUnderDir } from '../utils/safe_io.js';

export function memoryRoot(projectRoot = process.cwd(), override?: string): string {
  const root = resolve(override ?? join(projectRoot, '.nova', 'memory'));
  return assertPathUnderDir(root, resolve(projectRoot, '.nova'), 'Memory root');
}

export function assertMemoryPath(path: string, root: string, label = 'Memory path'): string {
  return assertPathUnderDir(resolve(path), root, label);
}

export function memoryPath(root: string, ...parts: string[]): string {
  const unsafe = parts.some((part) => isAbsolute(part) || part.includes('\0') || part.split(/[\\/]+/).includes('..'));
  if (unsafe) throw new Error('Memory path parts must be relative and must not contain traversal');
  return assertMemoryPath(join(root, ...parts), root);
}

export const indexPath = (root: string) => memoryPath(root, '_index.json');
export const schemaPath = (root: string) => memoryPath(root, '_schema.json');
export const migrationsPath = (root: string) => memoryPath(root, '_migrations.json');
export const auditPath = (root: string) => memoryPath(root, 'audit.jsonl');
export const itemPath = (root: string, type: string, id: string) => memoryPath(root, 'items', type, `${id}.json`);
export const archivePath = (root: string, type: string, id: string) => memoryPath(root, 'archive', type, `${id}.json`);
export const collectionPath = (root: string, collection: string) => memoryPath(root, 'collections', `${safeName(collection)}.json`);
export const exportPath = (root: string, filename: string) => memoryPath(root, 'export', safeName(filename));
export const importPath = (root: string, filename: string) => memoryPath(root, 'import', safeName(filename));

export function safeName(value: string): string {
  const name = basename(value).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name || name === '.' || name === '..') throw new Error('Unsafe memory filename');
  return name;
}

export async function ensureMemoryLayout(root: string): Promise<void> {
  for (const dir of ['items', 'collections', 'archive', 'import', 'export']) {
    await mkdir(memoryPath(root, dir), { recursive: true });
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tmp, path);
}

export function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
}
