import { resolve } from 'node:path';
import { assertPathUnderDir, projectNovaDir } from '../utils/safe_io.js';
import type { HeartbeatAutomationTarget } from './types.js';

export interface HeartbeatPaths {
  root: string;
  state: string;
  ticks: string;
  locks: string;
  lock: string;
  plansDir: string;
  automationDir: string;
}

export function heartbeatPaths(projectRoot = process.cwd()): HeartbeatPaths {
  const novaDir = projectNovaDir(projectRoot);
  const root = assertPathUnderDir(resolve(novaDir, 'heartbeat'), novaDir, 'Heartbeat root');
  const ticks = assertPathUnderDir(resolve(root, 'ticks'), root, 'Heartbeat ticks dir');
  const locks = assertPathUnderDir(resolve(root, 'locks'), root, 'Heartbeat locks dir');
  return {
    root,
    state: assertPathUnderDir(resolve(root, 'state.json'), root, 'Heartbeat state path'),
    ticks,
    locks,
    lock: assertPathUnderDir(resolve(locks, 'heartbeat.lock'), root, 'Heartbeat lock path'),
    plansDir: heartbeatPlansDir(root),
    automationDir: heartbeatAutomationDir(root),
  };
}

/** `<root>/plans`, guarded by `assertPathUnderDir`. `root` is the heartbeat root. */
export function heartbeatPlansDir(root: string): string {
  return assertPathUnderDir(resolve(root, 'plans'), root, 'Heartbeat plans dir');
}

/** Absolute JSON + markdown paths for a plan id, both guarded under the heartbeat root. */
export function heartbeatPlanPaths(root: string, planId: string): { json: string; markdown: string } {
  const plansDir = heartbeatPlansDir(root);
  return {
    json: assertPathUnderDir(resolve(plansDir, `${planId}.json`), root, 'Heartbeat plan JSON path'),
    markdown: assertPathUnderDir(resolve(plansDir, `${planId}.md`), root, 'Heartbeat plan Markdown path'),
  };
}

/** `<root>/automation`, guarded by `assertPathUnderDir`. `root` is the heartbeat root. */
export function heartbeatAutomationDir(root: string): string {
  return assertPathUnderDir(resolve(root, 'automation'), root, 'Heartbeat automation dir');
}

/** Default `automation/<target>.txt` path for an automation target, guarded under the root. */
export function heartbeatAutomationPath(root: string, target: HeartbeatAutomationTarget): string {
  const automationDir = heartbeatAutomationDir(root);
  return assertPathUnderDir(resolve(automationDir, `${target}.txt`), root, 'Heartbeat automation path');
}

/**
 * Resolve a caller-supplied `--out` (relative to the heartbeat root) and assert it stays
 * under that root. Throws (caller maps to a usage error / exit 1) if it escapes the sandbox.
 */
export function resolveAutomationOutPath(root: string, relOut: string): string {
  return assertPathUnderDir(resolve(root, relOut), root, 'Heartbeat automation --out path');
}

export function heartbeatTickJsonPath(tickId: string, projectRoot = process.cwd()): string {
  const paths = heartbeatPaths(projectRoot);
  return assertPathUnderDir(resolve(paths.ticks, `${tickId}.json`), paths.root, 'Heartbeat tick JSON path');
}

export function heartbeatTickMarkdownPath(tickId: string, projectRoot = process.cwd()): string {
  const paths = heartbeatPaths(projectRoot);
  return assertPathUnderDir(resolve(paths.ticks, `${tickId}.md`), paths.root, 'Heartbeat tick Markdown path');
}
