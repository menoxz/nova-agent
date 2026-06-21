import type { EvalReport } from '../types.js';

function statusIcon(status: string): string {
  if (status === 'passed') return '✅';
  if (status === 'failed') return '❌';
  return '⚠️';
}

function tableCell(value: unknown): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

export function renderEvalMarkdown(report: EvalReport): string {
  const lines: string[] = [
    `# Nova Eval Report — ${report.evalRunId}`,
    '',
    `- Schema: v${report.schemaVersion}`,
    `- Mode: ${report.mode}`,
    `- Suite: ${report.suite ?? 'custom'}`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Pass rate: ${Math.round(report.summary.passRate * 100)}% (${report.summary.passed}/${report.summary.total})`,
    `- Failed: ${report.summary.failed}`,
    `- Errors: ${report.summary.errors}`,
    `- Average tool calls: ${report.summary.averageToolCalls}`,
    `- Average steps: ${report.summary.averageSteps}`,
    '',
  ];

  if (report.gates) {
    lines.push(`## Quality gates — ${report.gates.passed ? 'passed' : 'failed'}`, '', '| Gate | Status | Expected | Actual |', '| --- | --- | --- | --- |');
    for (const gate of report.gates.results) {
      lines.push(`| ${tableCell(gate.name)} | ${gate.passed ? '✅' : '❌'} | ${tableCell(gate.expected)} | ${tableCell(gate.actual)} |`);
    }
    lines.push('');
  }

  if (report.baseline) {
    lines.push(`## Baseline — ${report.baseline.passed ? 'no regression' : 'regression detected'}`, '');
    lines.push(`Baseline: \`${report.baseline.baselinePath}\``);
    if (report.baseline.regressions.length) {
      for (const regression of report.baseline.regressions) lines.push(`- ${regression.type}: ${regression.message}`);
    } else {
      lines.push('- No regressions detected.');
    }
    lines.push('');
  }

  lines.push('## Scenarios', '', '| Scenario | Status | Tools | Steps | Duration |', '| --- | --- | ---: | ---: | ---: |');
  for (const result of report.results) {
    lines.push(`| ${tableCell(result.scenarioId)} | ${statusIcon(result.status)} ${tableCell(result.status)} | ${result.metrics.toolCallCount} | ${result.metrics.stepCount} | ${result.durationMs}ms |`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}
