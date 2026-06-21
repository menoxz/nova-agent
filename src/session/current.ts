import { readFile, rm } from 'node:fs/promises';
import { currentSessionPath, sessionsRoot, writeJsonAtomic } from './paths.js';
import { SESSION_SCHEMA_VERSION, type CurrentSessionPointer, type SessionRuntimeConfig } from './types.js';
import { SessionStore } from './store.js';

export class CurrentSessionStore {
  public readonly root: string;
  private readonly store: SessionStore;

  constructor(config: SessionRuntimeConfig = {}) {
    this.root = sessionsRoot(config.projectRoot, config.sessionsRoot);
    this.store = new SessionStore(config);
  }

  async get(): Promise<CurrentSessionPointer | undefined> {
    try { return JSON.parse(await readFile(currentSessionPath(this.root), 'utf-8')) as CurrentSessionPointer; } catch { return undefined; }
  }

  async set(input: { sessionId: string; runId?: string; source: CurrentSessionPointer['source']; validate?: boolean }): Promise<CurrentSessionPointer> {
    if (input.validate !== false) {
      const session = await this.store.getSession(input.sessionId);
      if (!session) throw new Error(`Unknown session: ${input.sessionId}`);
      if (input.runId && !await this.store.getRun(input.sessionId, input.runId)) throw new Error(`Unknown run: ${input.sessionId}/${input.runId}`);
    }
    const pointer: CurrentSessionPointer = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: input.sessionId,
      runId: input.runId,
      updatedAt: new Date().toISOString(),
      source: input.source,
      safety: { metadataOnly: true, secretsIncluded: false, rawPromptsIncluded: false, rawToolInputsIncluded: false },
    };
    await writeJsonAtomic(currentSessionPath(this.root), pointer);
    return pointer;
  }

  async unset(): Promise<{ ok: true; removed: boolean }> {
    const existing = await this.get();
    await rm(currentSessionPath(this.root), { force: true });
    return { ok: true, removed: Boolean(existing) };
  }

  async requireCurrent(): Promise<CurrentSessionPointer> {
    const current = await this.get();
    if (!current) throw new Error('No current session set. Use: nova sessions use <sessionId>');
    return current;
  }
}
