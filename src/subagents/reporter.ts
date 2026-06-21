import type { StepDisplay } from '../types.js';
import { budgetExhausted } from './budget.js';
import type { BudgetState, ScopedContext, SubagentReport, SubagentRoleId, SubagentTask, SubagentTaskStatus } from './types.js';

function summarizeSteps(steps: StepDisplay[]): { findings: string[]; evidence: string[]; summary: string } {
  const answer = [...steps].reverse().find((step) => step.type === 'answer')?.content ?? 'No final answer returned.';
  const tools = steps.filter((step) => step.type === 'tool_call').map((step) => step.toolName ?? 'unknown');
  return {
    summary: answer.slice(0, 1_000),
    findings: [answer.slice(0, 1_000)],
    evidence: tools.length ? [`tools: ${Array.from(new Set(tools)).join(', ')}`] : ['no tools used'],
  };
}

type TerminalStatus = Exclude<SubagentTaskStatus, 'pending' | 'running'>;

function deriveStatus(steps: StepDisplay[], budget: BudgetState): TerminalStatus {
  if (budgetExhausted(budget)) return 'blocked';
  const finalAnswer = [...steps].reverse().find((step) => step.type === 'answer')?.content;
  if (!finalAnswer?.trim()) return 'blocked';
  if (/^\(?no response\)?$/i.test(finalAnswer.trim())) return 'blocked';
  const text = steps.map((step) => `${step.content}\n${step.toolResult ?? ''}`).join('\n');
  if (/budget exhausted|max tool calls|Policy (?:deny|ask)|execution blocked|refus(?:e|al|ed)|\bI can(?:not|'t)\b/i.test(text)) return 'blocked';
  if (/✖ Error:|Error executing tool|\b(?:fatal|uncaught) error\b/i.test(text)) return 'failed';
  return 'passed';
}

export function createSubagentReport(input: { task: SubagentTask; role: SubagentRoleId; steps: StepDisplay[]; budget: BudgetState; context: ScopedContext; status?: TerminalStatus; risk?: string }): SubagentReport {
  const summarized = summarizeSteps(input.steps);
  const status = input.status ?? deriveStatus(input.steps, input.budget);
  return {
    taskId: input.task.id,
    role: input.role,
    status,
    summary: summarized.summary,
    findings: summarized.findings,
    evidence: [...summarized.evidence, ...input.context.resources.map((resource) => `context:${resource.safePath}`)],
    risks: [input.risk, status !== 'passed' ? `worker status: ${status}` : undefined].filter((risk): risk is string => Boolean(risk)),
    verification: input.task.kind === 'verify' ? { independent: input.task.producerTaskId !== input.task.id, producerTaskId: input.task.producerTaskId, method: 'delegated read-only review' } : undefined,
    budget: {
      toolCalls: input.budget.toolCalls,
      durationMs: Date.now() - input.budget.startedAt,
      outputChars: input.budget.outputChars,
      exhausted: budgetExhausted(input.budget),
    },
    context: {
      included: input.context.resources.map((resource) => resource.safePath),
      omissions: input.context.omissions,
    },
    memoryProposals: summarized.findings.map((finding) => ({
      type: 'finding',
      collection: 'subagent_findings',
      scope: { kind: 'subagent', subagentRole: input.role },
      content: { title: `Subagent ${input.role} finding`, summary: finding.slice(0, 1_000), tags: ['subagent', input.role] },
      source: { kind: 'subagent', createdFrom: 'subagent-report' },
      quality: { confidence: status === 'passed' ? 0.7 : 0.4, importance: 0.4 },
    })),
    steps: input.steps,
  };
}
