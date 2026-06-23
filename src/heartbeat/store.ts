import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  HEARTBEAT_SCHEMA_VERSION,
  type HeartbeatAutomationManifest,
  type HeartbeatPlanReport,
  type HeartbeatState,
  type HeartbeatTickReport,
} from './types.js';
import { heartbeatAutomationPath, heartbeatPaths, heartbeatPlanPaths } from './paths.js';
import { renderHeartbeatPlanMarkdown } from './reporter.js';

export class HeartbeatStore {
  readonly paths;

  constructor(private readonly projectRoot = process.cwd()) {
    this.paths = heartbeatPaths(this.projectRoot);
  }

  async ensure(): Promise<void> {
    await mkdir(this.paths.ticks, { recursive: true });
    await mkdir(this.paths.locks, { recursive: true });
    await mkdir(this.paths.plansDir, { recursive: true });
    await mkdir(this.paths.automationDir, { recursive: true });
  }

  /**
   * Deterministic placeholder heartbeat id for a project that has never ticked
   * (no `state.json` yet). Derived from the project root so the same project
   * always yields byte-identical plan artifacts across runs (RISK-2). `planId`
   * already excludes `heartbeatId`; this only stabilises the embedded id in the
   * persisted plan report. Once a real `state.json` exists, its persisted
   * `heartbeatId` is used instead. Pure: hash only, no clock, no randomness.
   */
  private placeholderHeartbeatId(): string {
    const digest = createHash('sha256').update(this.projectRoot).digest('hex');
    return `heartbeat_${digest.slice(0, 8)}`;
  }

  async readState(enabled = false): Promise<HeartbeatState> {
    await this.ensure();
    try {
      const parsed = JSON.parse(await readFile(this.paths.state, 'utf-8')) as Partial<HeartbeatState>;
      return {
        schemaVersion: HEARTBEAT_SCHEMA_VERSION,
        heartbeatId: typeof parsed.heartbeatId === 'string' ? parsed.heartbeatId : this.placeholderHeartbeatId(),
        enabled,
        updatedAt: new Date().toISOString(),
        lastTickId: typeof parsed.lastTickId === 'string' ? parsed.lastTickId : undefined,
        lastTickAt: typeof parsed.lastTickAt === 'string' ? parsed.lastTickAt : undefined,
        tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks as HeartbeatState['tasks'] : {},
      };
    } catch {
      return { schemaVersion: HEARTBEAT_SCHEMA_VERSION, heartbeatId: this.placeholderHeartbeatId(), enabled, updatedAt: new Date().toISOString(), tasks: {} };
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

  /**
   * Persist a (already-redacted) plan report as `plans/<planId>.{json,md}`.
   * Read-only with respect to `state.json` — planning never mutates state.
   */
  async writePlanReport(report: HeartbeatPlanReport): Promise<{ json: string; markdown: string }> {
    const markdown = renderHeartbeatPlanMarkdown(report);
    const planPaths = heartbeatPlanPaths(this.paths.root, report.planId);
    await this.withLock(async () => {
      await writeFileAtomic(planPaths.json, `${JSON.stringify(report, null, 2)}\n`);
      await writeFileAtomic(planPaths.markdown, markdown);
    });
    return planPaths;
  }

  async latestPlanReport(): Promise<HeartbeatPlanReport | undefined> {
    await this.ensure();
    const files = (await readdir(this.paths.plansDir).catch(() => [])).filter((name) => name.endsWith('.json')).sort().reverse();
    for (const file of files) {
      try {
        return JSON.parse(await readFile(join(this.paths.plansDir, file), 'utf-8')) as HeartbeatPlanReport;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  /**
   * Write an inert automation manifest body. Defaults to `automation/<target>.txt`;
   * `outPath` (already validated to stay under the heartbeat root) overrides it.
   */
  async writeAutomationManifest(manifest: HeartbeatAutomationManifest, outPath?: string): Promise<string> {
    const file = outPath ?? heartbeatAutomationPath(this.paths.root, manifest.target);
    const body = manifest.body.endsWith('\n') ? manifest.body : `${manifest.body}\n`;
    await this.withLock(async () => {
      await writeFileAtomic(file, body);
    });
    return file;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rm(path, { force: true }).catch(() => undefined);
  await import('node:fs/promises').then((fs) => fs.rename(tmp, path));
}
