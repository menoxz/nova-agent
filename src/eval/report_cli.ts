import chalk from 'chalk';

import {
  compareEvalReports,
  listEvalReports,
  renderEvalCompareMarkdown,
  renderEvalReportText,
  renderEvalSummaryMarkdown,
  resolveEvalReport,
  summarizeEvalReport,
  writeMarkdownOutput,
} from './reporting.js';

export async function handleEvalCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'eval') return false;
  const [action, ...rest] = positionalArgs(args.slice(1));

  try {
    if (action === 'list') {
      const reports = await listEvalReports({ limit: parseLimit(args) });
      if (hasFlag(args, 'json')) console.log(JSON.stringify(reports, null, 2));
      else printList(reports);
      return true;
    }

    if (action === 'report') {
      const selector = rest[0];
      if (!selector) return missingArgument('nova eval report latest|<evalRunId> [--json]');
      const { report, path } = await resolveEvalReport(selector);
      const summary = summarizeEvalReport(report, path);
      console.log(hasFlag(args, 'json') ? JSON.stringify(summary, null, 2) : renderEvalReportText(summary));
      return true;
    }

    if (action === 'summary') {
      const selector = rest[0];
      if (!selector) return missingArgument('nova eval summary latest|<evalRunId> [--markdown] [--out <path>]');
      const { report, path } = await resolveEvalReport(selector);
      const markdown = renderEvalSummaryMarkdown(summarizeEvalReport(report, path));
      const outPath = getArg(args, 'out') ?? getArg(args, 'md');
      if (outPath) {
        const written = await writeMarkdownOutput(outPath, markdown);
        console.log(`Eval summary Markdown written: ${written}`);
      } else {
        console.log(markdown);
      }
      return true;
    }

    if (action === 'compare') {
      const [previousRunId, currentRunId] = rest;
      if (!previousRunId || !currentRunId) return missingArgument('nova eval compare <previousRunId> <currentRunId> [--json|--markdown]');
      const previous = await resolveEvalReport(previousRunId);
      const current = await resolveEvalReport(currentRunId);
      const comparison = compareEvalReports(previous.report, previous.path, current.report, current.path);
      console.log(hasFlag(args, 'json') ? JSON.stringify(comparison, null, 2) : renderEvalCompareMarkdown(comparison));
      return true;
    }

    console.error(chalk.red(`Unknown eval command: nova ${args.join(' ')}`));
    console.error('Run nova eval --help for report commands. Live eval execution remains available through npm run eval or src/eval/runner.ts.');
    process.exitCode = 1;
    return true;
  } catch (err) {
    console.error(chalk.red(`Eval report command failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return true;
  }
}

function printList(reports: Awaited<ReturnType<typeof listEvalReports>>): void {
  if (!reports.length) {
    console.log('No eval reports found under .nova/evals.');
    return;
  }
  console.log('Eval reports');
  for (const report of reports) {
    console.log(`${report.evalRunId} | suite=${report.suite} mode=${report.mode} passRate=${Math.round(report.passRate * 10000) / 100}% passed=${report.passed}/${report.total} failed=${report.failed} errors=${report.errors} gates=${report.gates} ended=${report.endedAt}`);
  }
}

function missingArgument(usage: string): true {
  console.error(chalk.red(`Missing argument. Usage: ${usage}`));
  process.exitCode = 1;
  return true;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function getArg(args: string[], name: string): string | undefined {
  const directIndex = args.indexOf(`--${name}`);
  if (directIndex >= 0) return args[directIndex + 1];
  const prefix = `--${name}=`;
  const prefixed = args.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function parseLimit(args: string[]): number | undefined {
  const value = getArg(args, 'limit');
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error('--limit must be a positive integer');
  return parsed;
}

function positionalArgs(args: string[]): string[] {
  const values: string[] = [];
  const optionsWithValues = new Set(['limit', 'out', 'md']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0] ?? '';
      if (optionsWithValues.has(name) && !arg.includes('=')) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}
