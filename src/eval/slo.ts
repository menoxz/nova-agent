import type { EvalCompareSummary, SafeEvalReportSummary, SafeFailedScenario } from './reporting.js';

export const EVAL_SLO_SCHEMA_VERSION = 1 as const;

export type EvalSloReadinessStatus = 'ready' | 'not_ready';
export type EvalSloRegressionStatus = 'not_compared' | 'unchanged' | 'improved' | 'regressed';

export interface EvalSloDashboard {
  schemaVersion: typeof EVAL_SLO_SCHEMA_VERSION;
  run: {
    evalRunId: string;
    suite: string;
    mode: string;
    startedAt: string;
    endedAt: string;
    reportPath: string;
  };
  metrics: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    passRate: number;
    averageToolCalls: number;
    averageSteps: number;
    durationMs: number;
  };
  gates: {
    status: 'passed' | 'failed' | 'missing';
    passed: boolean | null;
    results: Array<{
      name: string;
      passed: boolean;
      expected: string;
      actual: string;
    }>;
  };
  toolCallBudgets: {
    averageToolCalls: number;
    configured: Array<{
      name: 'max_average_tool_calls' | 'max_scenario_tool_calls';
      passed: boolean;
      expected: string;
      actual: string;
    }>;
  };
  failures: {
    count: number;
    scenarios: SafeFailedScenario[];
  };
  regression: {
    status: EvalSloRegressionStatus;
    previousEvalRunId?: string;
    deltas?: EvalCompareSummary['deltas'];
    newlyFailed: SafeFailedScenario[];
    recovered: SafeFailedScenario[];
  };
  readiness: {
    status: EvalSloReadinessStatus;
    reasons: string[];
  };
}

type ToolCallBudget = EvalSloDashboard['toolCallBudgets']['configured'][number];

export function buildEvalSloDashboard(current: SafeEvalReportSummary, comparison?: EvalCompareSummary): EvalSloDashboard {
  const gatesPassed = current.gates === 'passed' ? true : current.gates === 'failed' ? false : null;
  const regressionStatus = classifyRegression(comparison);
  const readinessReasons = readinessReasonsFor(current, regressionStatus, comparison);

  return {
    schemaVersion: EVAL_SLO_SCHEMA_VERSION,
    run: {
      evalRunId: current.evalRunId,
      suite: current.suite,
      mode: current.mode,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      reportPath: current.reportPath,
    },
    metrics: {
      total: current.total,
      passed: current.passed,
      failed: current.failed,
      errors: current.errors,
      passRate: current.passRate,
      averageToolCalls: current.averageToolCalls,
      averageSteps: current.averageSteps,
      durationMs: current.durationMs,
    },
    gates: {
      status: current.gates,
      passed: gatesPassed,
      results: current.gatesDetail?.results ?? [],
    },
    toolCallBudgets: {
      averageToolCalls: current.averageToolCalls,
      configured: (current.gatesDetail?.results ?? [])
        .filter((gate) => isToolCallBudgetName(gate.name))
        .map((gate) => ({ name: gate.name as ToolCallBudget['name'], passed: gate.passed, expected: gate.expected, actual: gate.actual })),
    },
    failures: {
      count: current.failedScenarios.length,
      scenarios: current.failedScenarios,
    },
    regression: {
      status: regressionStatus,
      previousEvalRunId: comparison?.previous.evalRunId,
      deltas: comparison?.deltas,
      newlyFailed: comparison?.newlyFailed ?? [],
      recovered: comparison?.recovered ?? [],
    },
    readiness: {
      status: readinessReasons.length ? 'not_ready' : 'ready',
      reasons: readinessReasons,
    },
  };
}

export function renderEvalSloDashboardText(dashboard: EvalSloDashboard): string {
  const lines = [
    `Eval SLO Dashboard ${dashboard.run.evalRunId}`,
    `Suite: ${dashboard.run.suite} | Mode: ${dashboard.run.mode} | Schema: v${dashboard.schemaVersion}`,
    `Pass rate: ${formatPercent(dashboard.metrics.passRate)} (${dashboard.metrics.passed}/${dashboard.metrics.total}) | Failed: ${dashboard.metrics.failed} | Errors: ${dashboard.metrics.errors}`,
    `Gates: ${dashboard.gates.status} | Readiness: ${dashboard.readiness.status}`,
    `Average tool calls: ${dashboard.toolCallBudgets.averageToolCalls} | Average steps: ${dashboard.metrics.averageSteps} | Duration: ${dashboard.metrics.durationMs}ms`,
  ];

  if (dashboard.toolCallBudgets.configured.length) {
    lines.push('', 'Tool-call budgets:');
    for (const budget of dashboard.toolCallBudgets.configured) lines.push(`- ${budget.name}: ${budget.passed ? 'passed' : 'failed'} (expected=${budget.expected}; actual=${budget.actual})`);
  }

  if (dashboard.gates.results.length) {
    lines.push('', 'Gates detail:');
    for (const gate of dashboard.gates.results) lines.push(`- ${gate.name}: ${gate.passed ? 'passed' : 'failed'} (expected=${gate.expected}; actual=${gate.actual})`);
  }

  lines.push('', `Regression: ${dashboard.regression.status}`);
  if (dashboard.regression.previousEvalRunId) lines.push(`Previous: ${dashboard.regression.previousEvalRunId}`);
  if (dashboard.regression.deltas) {
    lines.push(`Deltas: passRate=${formatSignedPercent(dashboard.regression.deltas.passRate)} failed=${formatSigned(dashboard.regression.deltas.failed)} errors=${formatSigned(dashboard.regression.deltas.errors)} total=${formatSigned(dashboard.regression.deltas.total)}`);
  }
  lines.push('Newly failed:');
  lines.push(...scenarioLines(dashboard.regression.newlyFailed));
  lines.push('Recovered:');
  lines.push(...scenarioLines(dashboard.regression.recovered));

  lines.push('', 'Current failed scenarios:');
  lines.push(...scenarioLines(dashboard.failures.scenarios));

  if (dashboard.readiness.reasons.length) {
    lines.push('', 'Readiness blockers:');
    for (const reason of dashboard.readiness.reasons) lines.push(`- ${reason}`);
  }

  return `${lines.join('\n')}\n`;
}

function classifyRegression(comparison?: EvalCompareSummary): EvalSloRegressionStatus {
  if (!comparison) return 'not_compared';
  if (comparison.deltas.passRate < 0 || comparison.deltas.errors > 0 || comparison.newlyFailed.length > 0) return 'regressed';
  if (comparison.deltas.passRate > 0 || comparison.deltas.errors < 0 || comparison.recovered.length > 0) return 'improved';
  return 'unchanged';
}

function readinessReasonsFor(current: SafeEvalReportSummary, regressionStatus: EvalSloRegressionStatus, comparison?: EvalCompareSummary): string[] {
  const reasons: string[] = [];
  if (current.gates === 'failed') reasons.push('quality gates failed');
  if (current.gates === 'missing') reasons.push('quality gates missing');
  if (current.failed > 0) reasons.push('scenario failures present');
  if (current.errors > 0) reasons.push('runner errors present');
  if (regressionStatus === 'regressed') {
    if ((comparison?.deltas.passRate ?? 0) < 0) reasons.push('pass rate regressed');
    if ((comparison?.deltas.errors ?? 0) > 0) reasons.push('error count increased');
    if ((comparison?.newlyFailed.length ?? 0) > 0) reasons.push('new scenario failures detected');
  }
  return reasons;
}

function isToolCallBudgetName(name: string): name is ToolCallBudget['name'] {
  return name === 'max_average_tool_calls' || name === 'max_scenario_tool_calls';
}

function scenarioLines(scenarios: SafeFailedScenario[]): string[] {
  if (!scenarios.length) return ['- none'];
  return scenarios.map((scenario) => `- ${scenario.scenarioId} (${scenario.status}) ${scenario.name}${scenario.error ? ` — ${scenario.error}` : ''}`);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${formatPercent(value)}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
