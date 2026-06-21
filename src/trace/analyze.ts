import type { ToolCallEvent, ToolExecutionFinishEvent, TraceRun } from './types.js';

export interface TraceInsight {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  runId?: string;
  evidence?: Record<string, unknown>;
}

export interface TraceAnalysis {
  insightCount: number;
  insights: TraceInsight[];
}

export function analyzeTraceRuns(runs: TraceRun[]): TraceAnalysis {
  const insights: TraceInsight[] = [];

  for (const run of runs) {
    if (run.status === 'error') {
      insights.push({
        severity: 'critical',
        code: 'run_error',
        message: 'Run ended with an error.',
        runId: run.runId,
        evidence: { errors: run.events.filter((event) => event.type === 'error').map((event) => event.message) },
      });
    }

    const failedTools = run.events.filter((event): event is ToolExecutionFinishEvent => event.type === 'tool_execution_finish' && !event.ok);
    if (failedTools.length) {
      insights.push({
        severity: 'warning',
        code: 'tool_execution_errors',
        message: 'One or more tools failed during execution.',
        runId: run.runId,
        evidence: {
          count: failedTools.length,
          tools: failedTools.map((event) => event.toolName),
        },
      });
    }

    const toolCalls = run.events.filter((event): event is ToolCallEvent => event.type === 'tool_call');
    const repeated = findConsecutiveRepeats(toolCalls.map((event) => event.toolName));
    if (repeated.length) {
      insights.push({
        severity: 'warning',
        code: 'repeated_tool_calls',
        message: 'The same tool was called repeatedly in consecutive steps; inspect for loops or missing synthesis.',
        runId: run.runId,
        evidence: { repeated },
      });
    }

    if (run.metrics.toolCallCount > 10) {
      insights.push({
        severity: 'info',
        code: 'high_tool_call_count',
        message: 'Run used many tool calls; consider whether tool outputs or policies can be more efficient.',
        runId: run.runId,
        evidence: { toolCallCount: run.metrics.toolCallCount },
      });
    }

    if (run.metrics.finalAnswerChars < 20 && run.status === 'success') {
      insights.push({
        severity: 'warning',
        code: 'short_final_answer',
        message: 'Final answer is very short; verify that the response was useful and not prematurely terminated.',
        runId: run.runId,
        evidence: { finalAnswerChars: run.metrics.finalAnswerChars },
      });
    }
  }

  return { insightCount: insights.length, insights };
}

function findConsecutiveRepeats(values: string[]): Array<{ value: string; count: number }> {
  const repeated: Array<{ value: string; count: number }> = [];
  let current: string | undefined;
  let count = 0;
  for (const value of values) {
    if (value === current) {
      count += 1;
      continue;
    }
    if (current && count >= 3) repeated.push({ value: current, count });
    current = value;
    count = 1;
  }
  if (current && count >= 3) repeated.push({ value: current, count });
  return repeated;
}
