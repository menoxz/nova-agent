import type { SubagentRoleId, SubagentTask } from './types.js';

export interface TaskGraph {
  tasks: Map<string, SubagentTask>;
  dependents: Map<string, string[]>;
}

export function createTaskGraph(tasks: SubagentTask[]): TaskGraph {
  const byId = new Map<string, SubagentTask>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    byId.set(task.id, task);
  }
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) throw new Error(`Task ${task.id} depends on missing task ${dep}`);
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }
  rejectCycles(byId);
  validateVerificationGates(byId);
  return { tasks: byId, dependents };
}

const PRODUCER_ROLES = new Set<SubagentRoleId>(['builder', 'docs', 'refactor']);
const VERIFIER_ROLES = new Set<SubagentRoleId>(['reviewer', 'qa', 'security']);

function isProducerTask(task: SubagentTask): boolean {
  return PRODUCER_ROLES.has(task.role) || task.kind === 'produce' || task.kind === 'document' || task.kind === 'refactor';
}

function requiredVerifierRoles(task: SubagentTask): Set<SubagentRoleId> {
  if (task.securitySensitive) return new Set(['security']);
  if (task.role === 'docs' || task.kind === 'document') return new Set(['reviewer']);
  return new Set(['reviewer', 'qa']);
}

function isVerificationTaskFor(verifier: SubagentTask, producer: SubagentTask): boolean {
  if (!VERIFIER_ROLES.has(verifier.role)) return false;
  if (verifier.id === producer.id || verifier.role === producer.role) return false;
  if (verifier.producerTaskId && verifier.producerTaskId !== producer.id) return false;
  if (!(verifier.dependsOn ?? []).includes(producer.id)) return false;
  return verifier.kind === 'verify' || verifier.kind === 'review';
}

function validateVerificationGates(tasks: Map<string, SubagentTask>): void {
  const allTasks = [...tasks.values()];
  for (const producer of allTasks.filter(isProducerTask)) {
    const requiredRoles = requiredVerifierRoles(producer);
    const verifier = allTasks.find((candidate) => isVerificationTaskFor(candidate, producer) && requiredRoles.has(candidate.role));
    if (!verifier) {
      throw new Error(`Task graph rejected: producer task ${producer.id} (${producer.role}/${producer.kind}) requires an independent dependent ${[...requiredRoles].join(' or ')} verification task`);
    }
  }
}

function rejectCycles(tasks: Map<string, SubagentTask>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) throw new Error(`Task graph cycle rejected: ${[...path, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of tasks.get(id)?.dependsOn ?? []) visit(dep, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of tasks.keys()) visit(id, []);
}

export function readyTasks(graph: TaskGraph, completed: Set<string>, running: Set<string> = new Set()): SubagentTask[] {
  return [...graph.tasks.values()].filter((task) => !completed.has(task.id)
    && !running.has(task.id)
    && (task.dependsOn ?? []).every((dep) => completed.has(dep)));
}

export function topologicalBatches(graph: TaskGraph): SubagentTask[][] {
  const completed = new Set<string>();
  const batches: SubagentTask[][] = [];
  while (completed.size < graph.tasks.size) {
    const batch = readyTasks(graph, completed);
    if (!batch.length) throw new Error('Task graph has no ready tasks');
    batches.push(batch);
    for (const task of batch) completed.add(task.id);
  }
  return batches;
}

function scopesOverlap(a: string[] = [], b: string[] = []): boolean {
  if (!a.length || !b.length) return false;
  return a.some((left) => b.some((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
}

export function parallelizableBatch(tasks: SubagentTask[]): SubagentTask[] {
  const selected: SubagentTask[] = [];
  for (const task of tasks) {
    const readOnlyKind = task.kind !== 'produce' && task.kind !== 'refactor';
    if (!readOnlyKind) {
      if (!selected.length) selected.push(task);
      continue;
    }
    if (!selected.some((other) => scopesOverlap(other.scope, task.scope))) selected.push(task);
  }
  return selected;
}
