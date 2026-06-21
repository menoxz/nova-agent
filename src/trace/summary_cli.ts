#!/usr/bin/env node

import chalk from 'chalk';

import { summarizeTraces } from './summary.js';

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const directIndex = process.argv.indexOf(`--${name}`);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.argv.includes(name);
}

async function main(): Promise<void> {
  const traceDir = getArg('trace-dir');
  const limit = getArg('limit') ? Number(getArg('limit')) : undefined;
  const json = hasFlag('json');

  const summary = await summarizeTraces({ traceDir, limit });
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(chalk.cyanBright.bold('Nova Trace Summary'));
  console.log(chalk.gray(summary.directory));
  console.log(`Runs: ${summary.runCount} | Success: ${summary.successCount} | Error: ${summary.errorCount}`);
  console.log(`Avg duration: ${summary.averageDurationMs}ms | Avg steps: ${summary.averageSteps} | Avg tool calls: ${summary.averageToolCalls}`);
  if (summary.mostUsedTools.length) {
    console.log('\nMost used tools:');
    for (const tool of summary.mostUsedTools) console.log(`- ${tool.toolName}: ${tool.count}`);
  }
  if (summary.insights.length) {
    console.log('\nInsights:');
    for (const insight of summary.insights.slice(0, 20)) {
      const color = insight.severity === 'critical' ? chalk.red : insight.severity === 'warning' ? chalk.yellow : chalk.gray;
      console.log(color(`- [${insight.severity}] ${insight.code}: ${insight.message}${insight.runId ? ` (${insight.runId})` : ''}`));
    }
  }
  if (summary.recentRuns.length) {
    console.log('\nRecent runs:');
    for (const run of summary.recentRuns) {
      console.log(`- ${run.startedAt} ${run.status} ${run.runId} (${run.durationMs}ms, tools=${run.toolCallCount})`);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red('Trace summary failed:'), err);
  process.exit(1);
});
