import type { AgentConfig } from '../types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ActorContext } from '../policy/types.js';
import { createTaskGraph, parallelizableBatch, topologicalBatches } from './task_graph.js';
import { SubagentTraceRecorder } from './trace.js';
import { SubagentWorker } from './worker.js';
import type { AuthorityGrant, SubagentTask, WorkerRunResult } from './types.js';

export interface OrchestratorRunInput {
  tasks: SubagentTask[];
  parentActor: ActorContext;
  parentGrant: AuthorityGrant;
  root?: string;
}

export class SubagentOrchestrator {
  public readonly trace = new SubagentTraceRecorder();
  private readonly worker: SubagentWorker;

  constructor(config: AgentConfig, tools: ToolRegistry) {
    this.worker = new SubagentWorker(config, tools);
  }

  async run(input: OrchestratorRunInput): Promise<WorkerRunResult[]> {
    const graph = createTaskGraph(input.tasks);
    this.trace.lifecycle('graph_ready', input.parentActor, { safeMetadata: { taskCount: input.tasks.length } });
    const results = new Map<string, WorkerRunResult>();
    for (const batch of topologicalBatches(graph)) {
      const parallel = parallelizableBatch(batch);
      const runOne = async (task: SubagentTask): Promise<WorkerRunResult> => {
        this.trace.lifecycle('delegation_created', input.parentActor, { taskId: task.id, role: task.role });
        this.trace.lifecycle('worker_started', input.parentActor, { taskId: task.id, role: task.role });
        const result = await this.worker.run({ task, parentActor: input.parentActor, parentGrant: input.parentGrant, root: input.root ?? process.cwd() });
        this.trace.lifecycle('worker_finished', result.actor, { delegationId: result.delegation.delegationId, taskId: task.id, role: task.role, safeMetadata: { status: result.report.status } });
        return result;
      };
      const parallelIds = new Set(parallel.map((task) => task.id));
      for (const result of await Promise.all(parallel.map(runOne))) results.set(result.task.id, result);
      for (const task of batch.filter((candidate) => !parallelIds.has(candidate.id))) {
        const result = await runOne(task);
        results.set(result.task.id, result);
      }
    }
    return input.tasks.map((task) => results.get(task.id)).filter((result): result is WorkerRunResult => Boolean(result));
  }
}
