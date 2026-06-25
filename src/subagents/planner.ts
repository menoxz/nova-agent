import { redactString } from '../policy/redact.js';
import { listSubagentRoles } from './registry.js';
import { createTaskGraph, parallelizableBatch, topologicalBatches } from './task_graph.js';
import type { SubagentRoleId, SubagentTask, SubagentTaskKind } from './types.js';

const ROLE_IDS = new Set<SubagentRoleId>(listSubagentRoles().map((role) => role.id));
const KIND_IDS = new Set<SubagentTaskKind>(['produce', 'verify', 'review', 'research', 'document', 'refactor']);

export interface SubagentPlanTaskSummary {
  id: string;
  role: SubagentRoleId;
  kind: SubagentTaskKind;
  dependsOn: string[];
  scope: string[];
  promptPreview: string;
  securitySensitive: boolean;
  producerTaskId?: string;
}

export interface SubagentPlanBatch {
  index: number;
  taskIds: string[];
  parallelizableTaskIds: string[];
  serialTaskIds: string[];
}

export interface SubagentPlanReport {
  schemaVersion: 1;
  mode: 'metadata-only-plan';
  generatedAt: string;
  taskCount: number;
  tasks: SubagentPlanTaskSummary[];
  batches: SubagentPlanBatch[];
  safety: {
    executesWorkers: false;
    invokesLlm: false;
    invokesTools: false;
    grantsWriteOrShell: false;
    recursiveDelegationAllowed: false;
    requiresIndependentProducerVerification: true;
  };
}

export function parseSubagentTasks(value: unknown): SubagentTask[] {
  const rawTasks = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.tasks) ? value.tasks : undefined;
  if (!rawTasks) throw new Error('Subagent plan input must be an array or an object with a tasks array.');
  return rawTasks.map((raw, index) => normalizeTask(raw, index));
}

export function planSubagentTasks(tasks: SubagentTask[]): SubagentPlanReport {
  const graph = createTaskGraph(tasks);
  const batches = topologicalBatches(graph).map((batch, index) => {
    const parallelizable = parallelizableBatch(batch);
    const parallelIds = new Set(parallelizable.map((task) => task.id));
    return {
      index: index + 1,
      taskIds: batch.map((task) => task.id),
      parallelizableTaskIds: parallelizable.map((task) => task.id),
      serialTaskIds: batch.filter((task) => !parallelIds.has(task.id)).map((task) => task.id),
    };
  });
  return {
    schemaVersion: 1,
    mode: 'metadata-only-plan',
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    tasks: tasks.map(toSummary),
    batches,
    safety: {
      executesWorkers: false,
      invokesLlm: false,
      invokesTools: false,
      grantsWriteOrShell: false,
      recursiveDelegationAllowed: false,
      requiresIndependentProducerVerification: true,
    },
  };
}

function normalizeTask(raw: unknown, index: number): SubagentTask {
  if (!isRecord(raw)) throw new Error(`Task at index ${index} must be an object.`);
  const id = stringField(raw, 'id');
  const role = stringField(raw, 'role');
  const kind = stringField(raw, 'kind');
  const prompt = stringField(raw, 'prompt');
  if (!ROLE_IDS.has(role as SubagentRoleId)) throw new Error(`Task ${id} has unknown role: ${role}`);
  if (!KIND_IDS.has(kind as SubagentTaskKind)) throw new Error(`Task ${id} has unknown kind: ${kind}`);
  return {
    id,
    role: role as SubagentRoleId,
    kind: kind as SubagentTaskKind,
    prompt,
    dependsOn: stringArray(raw.dependsOn, 'dependsOn'),
    scope: stringArray(raw.scope, 'scope'),
    producerTaskId: optionalString(raw.producerTaskId, 'producerTaskId'),
    securitySensitive: raw.securitySensitive === true,
  };
}

function toSummary(task: SubagentTask): SubagentPlanTaskSummary {
  return {
    id: task.id,
    role: task.role,
    kind: task.kind,
    dependsOn: task.dependsOn ?? [],
    scope: task.scope ?? [],
    promptPreview: redactString(task.prompt, 160),
    securitySensitive: task.securitySensitive === true,
    producerTaskId: task.producerTaskId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Task field ${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Task field ${field} must be a non-empty string when present.`);
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`Task field ${field} must be an array of strings when present.`);
  return value.map((item) => item.trim());
}
