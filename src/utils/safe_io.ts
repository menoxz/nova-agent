import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

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

/**
 * Resolve `target` to its physical path, following symlinks on every component
 * that already exists. Non-existent leading-edge components (the file we are
 * about to create, or directories not yet `ensure()`d) are re-appended to the
 * deepest existing real ancestor. Falls back to a purely logical `resolve` only
 * if the filesystem cannot be probed up to the root, so this never throws and
 * never widens containment (the logical check has already run by then).
 */
function realpathDeepestExisting(target: string): string {
  let current = resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : resolve(real, ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return resolve(target);
      }
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

export function assertPathUnderDir(path: string, parentDir: string, label: string): string {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parentDir);
  // Logical containment first: rejects `../` and absolute escapes up front with
  // the existing message, before touching the filesystem.
  if (!isPathInside(resolvedPath, resolvedParent)) {
    throw new Error(`${label} must stay under ${resolvedParent}. Got: ${resolvedPath}`);
  }
  // Physical containment: resolve symlinks on the deepest existing ancestors of
  // BOTH the jail and the target, then re-check. Defeats a pre-existing in-jail
  // symlink that points outside the jail (RISK-1); realpathing both sides also
  // cancels shared symlinked prefixes (e.g. /tmp -> /private/tmp on macOS).
  const realParent = realpathDeepestExisting(resolvedParent);
  const realPath = realpathDeepestExisting(resolvedPath);
  if (!isPathInside(realPath, realParent)) {
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
