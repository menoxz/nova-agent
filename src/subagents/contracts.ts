import type { SubagentReport, SubagentTask } from './types.js';

export function assertNoRecursiveDelegation(task: SubagentTask): void {
  if (/\b(spawn|delegate|sub-?agent)\b/i.test(task.prompt) && /\b(create|start|launch|call)\b/i.test(task.prompt)) {
    throw new Error(`Sub-agent task ${task.id} appears to request recursive sub-agent spawning, which is out of scope for V1`);
  }
}

export function assertProducerCannotSelfVerify(task: SubagentTask): void {
  if (task.kind === 'verify' && task.producerTaskId && task.producerTaskId === task.id) {
    throw new Error(`Task ${task.id} cannot verify itself`);
  }
}

export function assertStructuredReport(report: SubagentReport): void {
  if (!report.summary.trim()) throw new Error(`Sub-agent ${report.taskId} report summary is required`);
  if (!Array.isArray(report.findings) || !Array.isArray(report.evidence) || !Array.isArray(report.risks)) {
    throw new Error(`Sub-agent ${report.taskId} report must include findings, evidence, and risks arrays`);
  }
}
