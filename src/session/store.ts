import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { sessionIndexPath, sessionRecordPath, runRecordPath, ensureSessionLayout, sessionsRoot, sessionPath, writeJsonAtomic } from './paths.js';
import { SESSION_SCHEMA_VERSION, type RunRecord, type SessionIndex, type SessionRecord, type SessionRuntimeConfig } from './types.js';

export class SessionStore {
  public readonly root: string;

  constructor(config: SessionRuntimeConfig = {}) {
    this.root = sessionsRoot(config.projectRoot, config.sessionsRoot);
  }

  async init(): Promise<void> {
    await ensureSessionLayout(this.root);
    try { await readFile(sessionIndexPath(this.root), 'utf-8'); } catch { await this.writeIndex({ schemaVersion: SESSION_SCHEMA_VERSION, updatedAt: new Date().toISOString(), sessions: [], runs: [] }); }
  }

  async saveSession(session: SessionRecord): Promise<void> {
    await this.init();
    await writeJsonAtomic(sessionRecordPath(this.root, session.id), session);
    await this.rebuildIndex();
  }

  async saveRun(run: RunRecord): Promise<void> {
    await this.init();
    await mkdir(sessionPath(this.root, 'runs', run.sessionId), { recursive: true });
    await writeJsonAtomic(runRecordPath(this.root, run.sessionId, run.id), run);
    await this.rebuildIndex();
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    await this.init();
    try { return JSON.parse(await readFile(sessionRecordPath(this.root, id), 'utf-8')) as SessionRecord; } catch { return undefined; }
  }

  async getRun(sessionId: string, runId: string): Promise<RunRecord | undefined> {
    await this.init();
    try { return JSON.parse(await readFile(runRecordPath(this.root, sessionId, runId), 'utf-8')) as RunRecord; } catch { return undefined; }
  }

  async listSessions(): Promise<SessionRecord[]> {
    await this.init();
    const dir = sessionPath(this.root, 'sessions');
    return readJsonRecords<SessionRecord>(dir);
  }

  async listRuns(sessionId?: string): Promise<RunRecord[]> {
    await this.init();
    const base = sessionPath(this.root, 'runs');
    const sessions = sessionId ? [sessionId] : await listDirs(base);
    const runs: RunRecord[] = [];
    for (const id of sessions) runs.push(...await readJsonRecords<RunRecord>(sessionPath(base, id)));
    return runs;
  }

  async readIndex(): Promise<SessionIndex> {
    await this.init();
    return JSON.parse(await readFile(sessionIndexPath(this.root), 'utf-8')) as SessionIndex;
  }

  async rebuildIndex(): Promise<SessionIndex> {
    const sessions = await this.listSessions();
    const runs = await this.listRuns();
    const index: SessionIndex = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({ id: session.id, title: session.title, status: session.status, updatedAt: session.updatedAt, activeRunId: session.activeRunId, runCount: session.runIds.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      runs: runs.map((run) => ({ id: run.id, sessionId: run.sessionId, status: run.status, objective: run.objective, updatedAt: run.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
    await this.writeIndex(index);
    return index;
  }

  private async writeIndex(index: SessionIndex): Promise<void> {
    await writeJsonAtomic(sessionIndexPath(this.root), index);
  }
}

export function newSessionId(): string { return `ses_${randomUUID()}`; }
export function newRunId(): string { return `run_${randomUUID()}`; }

async function readJsonRecords<T>(dir: string): Promise<T[]> {
  try { await stat(dir); } catch { return []; }
  const out: T[] = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.json')) continue;
    try { out.push(JSON.parse(await readFile(sessionPath(dir, file), 'utf-8')) as T); } catch { /* ignore malformed local artifacts in index rebuild */ }
  }
  return out;
}

async function listDirs(dir: string): Promise<string[]> {
  try { await stat(dir); } catch { return []; }
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isDirectory()) out.push(entry.name);
  return out;
}
