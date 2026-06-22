import type { ProjectConfigLoadResult } from '../config/project.js';
import { readProjectConfig } from '../config/project.js';
import { resolveHeartbeatConfig } from './config.js';
import { classifyHeartbeatTaskSafety, normalizeHeartbeatSchedule } from './config.js';
import { HeartbeatStore } from './store.js';
import { runHeartbeatDryRunTick } from './runner.js';
import type { HeartbeatConfig } from './types.js';

export * from './types.js';
export * from './config.js';
export * from './paths.js';
export * from './store.js';
export * from './runner.js';
export * from './reporter.js';

export async function handleHeartbeatCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'heartbeat') return false;
  const project = readProjectConfig();
  if (action === 'validate') return printHeartbeatValidate(project);
  if (action === 'status') return printHeartbeatStatus(project);
  if (action === 'tasks') return printHeartbeatTasks(project);
  if (action === 'tick') return runHeartbeatTickCli(project, rest);
  if (action === 'report' && rest[0] === 'latest') return printLatestHeartbeatReport();
  if (action === 'report') return heartbeatUsageError('Missing argument. Usage: nova heartbeat report latest');
  return heartbeatUsageError(`Unknown heartbeat command: ${args.join(' ') || 'heartbeat'}`);
}

function heartbeatConfigFrom(project: ProjectConfigLoadResult): HeartbeatConfig | undefined {
  return project.ok ? project.config?.heartbeat : undefined;
}

function printHeartbeatValidate(project: ProjectConfigLoadResult): true {
  const heartbeat = resolveHeartbeatConfig(heartbeatConfigFrom(project));
  const tasks = heartbeat.tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    action: task.action,
    enabled: task.enabled !== false,
    schedule: normalizeHeartbeatSchedule(task.schedule),
    safety: classifyHeartbeatTaskSafety(task),
  }));
  console.log(JSON.stringify({ path: project.path, present: project.present, ok: project.ok, errors: project.errors, heartbeat: { ...heartbeat, tasks } }, null, 2));
  process.exitCode = project.ok ? 0 : 1;
  return true;
}

async function printHeartbeatStatus(project: ProjectConfigLoadResult): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const heartbeat = resolveHeartbeatConfig(project.config?.heartbeat);
  const store = new HeartbeatStore();
  const state = await store.readState(heartbeat.enabled);
  console.log(JSON.stringify({ ok: true, enabled: heartbeat.enabled, taskCount: heartbeat.tasks.length, statePath: store.paths.state, ticksDir: store.paths.ticks, lockPath: store.paths.lock, lastTickId: state.lastTickId, lastTickAt: state.lastTickAt }, null, 2));
  return true;
}

async function printHeartbeatTasks(project: ProjectConfigLoadResult): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  const heartbeat = resolveHeartbeatConfig(project.config?.heartbeat);
  const store = new HeartbeatStore();
  const state = await store.readState(heartbeat.enabled);
  const { planHeartbeatTask } = await import('./runner.js');
  console.log(JSON.stringify({ ok: true, enabled: heartbeat.enabled, tasks: heartbeat.tasks.map((task) => planHeartbeatTask(task, state, heartbeat.enabled, new Date())) }, null, 2));
  return true;
}

async function runHeartbeatTickCli(project: ProjectConfigLoadResult, rest: string[]): Promise<true> {
  if (!project.ok) return printInvalidProject(project);
  if (!rest.includes('--dry-run')) return heartbeatUsageError('Heartbeat V1 supports only explicit dry-run ticks. Usage: nova heartbeat tick --dry-run');
  try {
    const report = await runHeartbeatDryRunTick({ config: project.config?.heartbeat });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } catch (err) {
    console.error(`Heartbeat tick failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
  return true;
}

async function printLatestHeartbeatReport(): Promise<true> {
  const report = await new HeartbeatStore().latestTickReport();
  if (!report) {
    console.error('No heartbeat reports found. Run `nova heartbeat tick --dry-run` first; V1 never starts a daemon automatically.');
    process.exitCode = 1;
    return true;
  }
  console.log(JSON.stringify(report, null, 2));
  return true;
}

function printInvalidProject(project: ProjectConfigLoadResult): true {
  console.error(`Invalid Nova project config at ${project.path}: ${project.errors.join('; ')}`);
  process.exitCode = 1;
  return true;
}

function heartbeatUsageError(message: string): true {
  console.error(message);
  console.error('Run `nova heartbeat --help` for supported V1 commands.');
  process.exitCode = 1;
  return true;
}
