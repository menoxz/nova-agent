import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_JSON_MAX_BYTES = 10 * 1024 * 1024;

export function projectNovaDir(projectRoot = process.cwd()): string {
  return resolve(projectRoot, '.nova');
}

export function isPathInside(childPath: string, parentDir: string): boolean {
  const child = resolve(childPath);
  const parent = resolve(parentDir);
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertPathUnderDir(path: string, parentDir: string, label: string): string {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parentDir);
  if (!isPathInside(resolvedPath, resolvedParent)) {
    throw new Error(`${label} must stay under ${resolvedParent}. Got: ${resolvedPath}`);
  }
  return resolvedPath;
}

export async function readJsonFileBounded(path: string, label: string, maxBytes = DEFAULT_JSON_MAX_BYTES): Promise<unknown> {
  const resolved = resolve(path);
  const stats = await stat(resolved);
  if (!stats.isFile()) throw new Error(`${label} is not a file: ${resolved}`);
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large to parse as JSON (${stats.size} bytes > ${maxBytes} bytes): ${resolved}`);
  }
  return JSON.parse(await readFile(resolved, 'utf-8')) as unknown;
}
