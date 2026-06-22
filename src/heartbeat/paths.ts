import { resolve } from 'node:path';
import { assertPathUnderDir, projectNovaDir } from '../utils/safe_io.js';

export interface HeartbeatPaths {
  root: string;
  state: string;
  ticks: string;
  locks: string;
  lock: string;
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
  };
}

export function heartbeatTickJsonPath(tickId: string, projectRoot = process.cwd()): string {
  const paths = heartbeatPaths(projectRoot);
  return assertPathUnderDir(resolve(paths.ticks, `${tickId}.json`), paths.root, 'Heartbeat tick JSON path');
}

export function heartbeatTickMarkdownPath(tickId: string, projectRoot = process.cwd()): string {
  const paths = heartbeatPaths(projectRoot);
  return assertPathUnderDir(resolve(paths.ticks, `${tickId}.md`), paths.root, 'Heartbeat tick Markdown path');
}
