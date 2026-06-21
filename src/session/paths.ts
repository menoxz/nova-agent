import { basename, dirname, join, resolve } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { assertPathUnderDir } from '../utils/safe_io.js';

export function sessionsRoot(projectRoot = process.cwd(), override?: string): string {
  const root = resolve(override ?? join(projectRoot, '.nova', 'sessions'));
  return assertPathUnderDir(root, resolve(projectRoot, '.nova'), 'Session root');
}

export function sessionPath(root: string, ...parts: string[]): string {
  const unsafe = parts.some((part) => part.includes('\0') || part.split(/[\\/]+/).includes('..'));
  if (unsafe) throw new Error('Session path parts must be relative and must not contain traversal');
  return assertPathUnderDir(join(root, ...parts), root, 'Session path');
}

export const sessionIndexPath = (root: string) => sessionPath(root, '_index.json');
export const currentSessionPath = (root: string) => sessionPath(root, '_current.json');
export const sessionRecordPath = (root: string, id: string) => sessionPath(root, 'sessions', `${safeName(id)}.json`);
export const runRecordPath = (root: string, sessionId: string, runId: string) => sessionPath(root, 'runs', safeName(sessionId), `${safeName(runId)}.json`);
export const conversationRecordPath = (root: string, sessionId: string) => sessionPath(root, 'conversations', `${safeName(sessionId)}.json`);

export async function ensureSessionLayout(root: string): Promise<void> {
  await mkdir(sessionPath(root, 'sessions'), { recursive: true });
  await mkdir(sessionPath(root, 'runs'), { recursive: true });
  await mkdir(sessionPath(root, 'conversations'), { recursive: true });
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(tmp, path);
}

function safeName(value: string): string {
  const name = basename(value).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name || name === '.' || name === '..') throw new Error('Unsafe session filename');
  return name;
}
