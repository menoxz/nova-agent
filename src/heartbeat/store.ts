import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { HEARTBEAT_SCHEMA_VERSION, type HeartbeatState, type HeartbeatTickReport } from './types.js';
import { heartbeatPaths } from './paths.js';

export class HeartbeatStore {
  readonly paths;

  constructor(private readonly projectRoot = process.cwd()) {
    this.paths = heartbeatPaths(this.projectRoot);
  }

  async ensure(): Promise<void> {
    await mkdir(this.paths.ticks, { recursive: true });
    await mkdir(this.paths.locks, { recursive: true });
  }

  async readState(enabled = false): Promise<HeartbeatState> {
    await this.ensure();
    try {
      const parsed = JSON.parse(await readFile(this.paths.state, 'utf-8')) as Partial<HeartbeatState>;
      return {
        schemaVersion: HEARTBEAT_SCHEMA_VERSION,
        heartbeatId: typeof parsed.heartbeatId === 'string' ? parsed.heartbeatId : `heartbeat_${randomUUID().slice(0, 8)}`,
        enabled,
        updatedAt: new Date().toISOString(),
        lastTickId: typeof parsed.lastTickId === 'string' ? parsed.lastTickId : undefined,
        lastTickAt: typeof parsed.lastTickAt === 'string' ? parsed.lastTickAt : undefined,
        tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks as HeartbeatState['tasks'] : {},
      };
    } catch {
      return { schemaVersion: HEARTBEAT_SCHEMA_VERSION, heartbeatId: `heartbeat_${randomUUID().slice(0, 8)}`, enabled, updatedAt: new Date().toISOString(), tasks: {} };
    }
  }

  async writeState(state: HeartbeatState): Promise<void> {
    await this.ensure();
    await writeFileAtomic(this.paths.state, `${JSON.stringify(state, null, 2)}\n`);
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensure();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let acquired = false;
    try {
      handle = await open(this.paths.lock, 'wx');
      acquired = true;
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2));
      await handle.close();
      handle = undefined;
      return await fn();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Heartbeat tick already in progress: ${this.paths.lock}`);
      throw err;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (acquired) await rm(this.paths.lock, { force: true }).catch(() => undefined);
    }
  }

  async writeTick(report: HeartbeatTickReport, markdown: string, writePaths = report.paths): Promise<void> {
    await this.ensure();
    await writeFileAtomic(writePaths.json, `${JSON.stringify(report, null, 2)}\n`);
    await writeFileAtomic(writePaths.markdown, markdown);
  }

  async latestTickReport(): Promise<HeartbeatTickReport | undefined> {
    await this.ensure();
    const files = (await readdir(this.paths.ticks).catch(() => [])).filter((name) => name.endsWith('.json')).sort().reverse();
    for (const file of files) {
      try {
        return JSON.parse(await readFile(join(this.paths.ticks, file), 'utf-8')) as HeartbeatTickReport;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rm(path, { force: true }).catch(() => undefined);
  await import('node:fs/promises').then((fs) => fs.rename(tmp, path));
}
