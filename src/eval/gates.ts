import type { EvalGateConfig, EvalGateSummary, EvalReport } from './types.js';

export const DEFAULT_GATE_CONFIG: EvalGateConfig = {
  minPassRate: 1,
  maxErrors: 0,
};

export function parseGateConfig(getArg: (name: string) => string | undefined): EvalGateConfig {
  return {
    minPassRate: getArg('min-pass-rate') ? Number(getArg('min-pass-rate')) : DEFAULT_GATE_CONFIG.minPassRate,
    maxErrors: getArg('max-errors') ? Number(getArg('max-errors')) : DEFAULT_GATE_CONFIG.maxErrors,
    maxAverageToolCalls: getArg('max-average-tool-calls') ? Number(getArg('max-average-tool-calls')) : undefined,
    maxScenarioToolCalls: getArg('max-scenario-tool-calls') ? Number(getArg('max-scenario-tool-calls')) : undefined,
  };
}

export function evaluateGates(report: EvalReport, config: EvalGateConfig): EvalGateSummary {
  const results = [
    {
      name: 'min_pass_rate',
      passed: report.summary.passRate >= config.minPassRate,
      expected: `>= ${config.minPassRate}`,
      actual: report.summary.passRate,
    },
    {
      name: 'max_errors',
      passed: report.summary.errors <= config.maxErrors,
      expected: `<= ${config.maxErrors}`,
      actual: report.summary.errors,
    },
  ];

  if (typeof config.maxAverageToolCalls === 'number') {
    results.push({
      name: 'max_average_tool_calls',
      passed: report.summary.averageToolCalls <= config.maxAverageToolCalls,
      expected: `<= ${config.maxAverageToolCalls}`,
      actual: report.summary.averageToolCalls,
    });
  }

  if (typeof config.maxScenarioToolCalls === 'number') {
    const maxActual = Math.max(0, ...report.results.map((result) => result.metrics.toolCallCount));
    results.push({
      name: 'max_scenario_tool_calls',
      passed: maxActual <= config.maxScenarioToolCalls,
      expected: `<= ${config.maxScenarioToolCalls}`,
      actual: maxActual,
    });
  }

  return {
    passed: results.every((result) => result.passed),
    config,
    results,
  };
}
