import { resolve } from 'node:path';

import { normalizeEvalReport } from './schema.js';
import type { EvalBaselineComparison, EvalReport } from './types.js';
import { readJsonFileBounded } from '../utils/safe_io.js';

export async function compareWithBaseline(current: EvalReport, baselinePath: string): Promise<EvalBaselineComparison> {
  const resolved = resolve(baselinePath);
  const baseline = normalizeEvalReport(await readJsonFileBounded(resolved, 'baseline eval report JSON'));
  if (!baseline) throw new Error(`Baseline is not a supported eval report: ${resolved}`);

  const regressions: EvalBaselineComparison['regressions'] = [];
  const previousById = new Map(baseline.results.map((result) => [result.scenarioId, result]));

  for (const result of current.results) {
    const previous = previousById.get(result.scenarioId);
    if (previous?.status === 'passed' && result.status !== 'passed') {
      regressions.push({
        scenarioId: result.scenarioId,
        type: 'new_failure',
        message: `${result.scenarioId} changed from passed to ${result.status}`,
      });
    }
  }

  if (current.summary.passRate < baseline.summary.passRate) {
    regressions.push({
      type: 'pass_rate_decrease',
      message: `Pass rate decreased from ${baseline.summary.passRate} to ${current.summary.passRate}`,
    });
  }

  if (current.summary.errors > baseline.summary.errors) {
    regressions.push({
      type: 'error_increase',
      message: `Errors increased from ${baseline.summary.errors} to ${current.summary.errors}`,
    });
  }

  return {
    baselinePath: resolved,
    passed: regressions.length === 0,
    previousPassRate: baseline.summary.passRate,
    currentPassRate: current.summary.passRate,
    previousErrors: baseline.summary.errors,
    currentErrors: current.summary.errors,
    regressions,
  };
}
