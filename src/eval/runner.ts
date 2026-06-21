#!/usr/bin/env node

import 'dotenv/config';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';

import { NovaAgent } from '../agent.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/builtin/read_file.js';
import { writeFileTool } from '../tools/builtin/write_file.js';
import { bashTool } from '../tools/builtin/bash.js';
import { globTool } from '../tools/builtin/glob.js';
import { grepTool } from '../tools/builtin/grep.js';
import { listDirectoryTool } from '../tools/builtin/list_directory.js';
import { getFileInfoTool } from '../tools/builtin/get_file_info.js';
import { readPdfTool } from '../tools/builtin/read_pdf.js';
import { readDocxTool } from '../tools/builtin/read_docx.js';
import { readExcelTool } from '../tools/builtin/read_excel.js';
import { webSearchTool } from '../tools/builtin/web_search.js';
import { gitTool } from '../tools/builtin/git.js';
import { todoTool } from '../tools/builtin/todo.js';
import { goalTool } from '../tools/builtin/goal.js';
import { skillTool } from '../tools/builtin/skill.js';
import type { AgentConfig, LLMConfig, StepDisplay } from '../types.js';
import { normalizeTraceRun } from '../trace/schema.js';
import type { TraceRun } from '../trace/types.js';
import { compareWithBaseline } from './baseline.js';
import { defaultScenarios } from './scenarios.js';
import { EVAL_SCHEMA_VERSION, normalizeEvalReport } from './schema.js';
import { judgeScenario } from './judge.js';
import { evaluateGates, parseGateConfig } from './gates.js';
import { listSuites, resolveScenarioSelection } from './suites.js';
import { renderEvalMarkdown } from './reporters/markdown.js';
import type { EvalMode, EvalReport, EvalReportFormat, EvalScenario, EvalScenarioResult } from './types.js';
import { assertPathUnderDir, projectNovaDir, readJsonFileBounded } from '../utils/safe_io.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.argv.includes(name);
}

function getArg(name: string): string | undefined {
  const directIndex = process.argv.indexOf(`--${name}`);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  const prefix = `--${name}=`;
  const prefixed = process.argv.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function getRepeatedArg(name: string): string[] {
  const values: string[] = [];
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === flag && process.argv[i + 1]) values.push(process.argv[i + 1]);
    if (arg?.startsWith(prefix)) values.push(arg.slice(prefix.length));
  }
  return values;
}

function getPositionalArgs(): string[] {
  const values: string[] = [];
  const optionsWithValues = new Set([
    'baseline',
    'max-average-tool-calls',
    'max-errors',
    'max-pass-rate',
    'max-scenario-tool-calls',
    'min-pass-rate',
    'mode',
    'out',
    'replay',
    'report',
    'scenario',
    'scenarios',
    'suite',
    'trace-content',
    'trace-dir',
  ]);
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg || arg.startsWith('--')) {
      const optionName = arg?.slice(2);
      if (optionName && optionsWithValues.has(optionName) && !arg.includes('=') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) i += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function setupTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  if (process.env.NOVA_ENABLE_WRITE_TOOLS === '1' || process.env.NOVA_ENABLE_WRITE_TOOLS === 'true') {
    registry.register(writeFileTool);
    registry.register(bashTool);
  }
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(listDirectoryTool);
  registry.register(getFileInfoTool);
  registry.register(readPdfTool);
  registry.register(readDocxTool);
  registry.register(readExcelTool);
  registry.register(webSearchTool);
  registry.register(gitTool);
  registry.register(todoTool);
  registry.register(goalTool);
  registry.register(skillTool);
  return registry;
}

async function loadScenarioCatalog(): Promise<EvalScenario[]> {
  const file = getArg('scenarios');
  if (!file) return defaultScenarios;
  const parsed = await readJsonFileBounded(resolve(file), '--scenarios JSON');
  if (!Array.isArray(parsed)) throw new Error('--scenarios must point to a JSON array of EvalScenario objects');
  return parsed as EvalScenario[];
}

function loadEvalConfig(evalRunId: string): AgentConfig {
  const llm: LLMConfig = {
    provider: process.env.LLM_PROVIDER || 'openrouter',
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'openmodel/deepseek-v4-flash',
    maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined,
  };
  return {
    llm,
    maxSteps: process.env.NOVA_EVAL_MAX_STEPS ? parseInt(process.env.NOVA_EVAL_MAX_STEPS) : 15,
    policy: {
      enabled: process.env.NOVA_POLICY_ENABLED !== '0' && process.env.NOVA_POLICY_ENABLED !== 'false',
      profileId: process.env.NOVA_POLICY_PROFILE || 'readonly',
      approvalProvided: false,
    },
    systemPrompt: [
      'You are Nova, an autonomous AI agent under evaluation.',
      'Follow the user request exactly, use tools when needed, avoid side effects unless explicitly requested, and answer concisely with evidence.',
    ].join('\n'),
    trace: {
      enabled: true,
      outputDir: getArg('trace-dir') || `.nova/evals/${evalRunId}/traces`,
      includeContent: getArg('trace-content') !== 'false',
      includeErrorStack: process.env.NOVA_TRACE_DEBUG_STACKS === '1' || process.env.NOVA_TRACE_DEBUG_STACKS === 'true',
      runIdPrefix: evalRunId,
    },
  };
}

function parseMode(): EvalMode {
  const mode = getArg('mode') ?? (getArg('replay') ? 'replay' : 'mock');
  if (mode !== 'live' && mode !== 'mock' && mode !== 'replay') throw new Error(`Unsupported --mode: ${mode}`);
  return mode;
}

function parseReportFormat(): EvalReportFormat {
  const value = getArg('report') ?? 'both';
  if (value !== 'json' && value !== 'markdown' && value !== 'both') throw new Error('--report must be json, markdown, or both');
  return value;
}

function buildMockSteps(scenario: EvalScenario): StepDisplay[] {
  if (scenario.mock?.steps?.length) return scenario.mock.steps;
  const tools = scenario.mock?.tools ?? scenario.expectedTools ?? (scenario.expectedAnyTools?.[0] ? [scenario.expectedAnyTools[0]] : []);
  const steps: StepDisplay[] = [];
  if (scenario.mock?.reasoning || tools.length) {
    steps.push({ type: 'reasoning', content: scenario.mock?.reasoning ?? `Plan: satisfy ${scenario.id} deterministically.` });
  }
  for (const toolName of tools) {
    steps.push({ type: 'tool_call', content: `Calling ${toolName}({})`, toolName, toolArgs: {} });
    steps.push({ type: 'tool_result', content: `Mock ${toolName} result for ${scenario.id}.`, toolName, toolResult: `Mock ${toolName} result.` });
  }
  const finalAnswer = scenario.mock?.finalAnswer
    ?? `Mock final answer for ${scenario.name}. ${(scenario.requiredAnswerIncludes ?? []).join(' ')}`.trim();
  steps.push({ type: 'answer', content: finalAnswer });
  return steps;
}

async function runLiveScenario(scenario: EvalScenario, config: AgentConfig): Promise<EvalScenarioResult> {
  const startedAt = Date.now();
  const agent = new NovaAgent(config, setupTools());
  const steps = await agent.run(scenario.prompt);
  return judgeScenario(scenario, steps, Date.now() - startedAt);
}

async function runMockScenario(scenario: EvalScenario): Promise<EvalScenarioResult> {
  const durationMs = scenario.mock?.durationMs ?? 1;
  return judgeScenario(scenario, buildMockSteps(scenario), durationMs);
}

function resultFromTrace(run: TraceRun): EvalScenarioResult {
  const failed = run.status === 'error' || run.metrics.errorCount > 0;
  const toolNames = Array.from(new Set(run.events.filter((event) => event.type === 'tool_call').map((event) => event.toolName))).sort();
  return {
    scenarioId: run.runId,
    name: `Replay trace ${run.runId}`,
    status: failed ? 'failed' : 'passed',
    durationMs: run.metrics.durationMs,
    metrics: {
      stepCount: run.metrics.stepCount,
      toolCallCount: run.metrics.toolCallCount,
      uniqueTools: toolNames,
      finalAnswerChars: run.metrics.finalAnswerChars,
    },
    checks: [{ name: 'trace_success', passed: !failed, expected: 'success with zero errors', actual: { status: run.status, errorCount: run.metrics.errorCount } }],
    finalAnswer: run.events.find((event) => event.type === 'final_answer')?.text,
  };
}

async function loadReplayResults(path: string): Promise<EvalScenarioResult[]> {
  const resolved = resolve(path);
  const stats = await stat(resolved);
  if (stats.isDirectory()) {
    const results: EvalScenarioResult[] = [];
    for (const file of (await readdir(resolved)).filter((name) => name.endsWith('.json')).sort()) {
      const run = normalizeTraceRun(await readJsonFileBounded(join(resolved, file), 'replay trace JSON'));
      if (run) results.push(resultFromTrace(run));
    }
    return results;
  }

  const parsed = await readJsonFileBounded(resolved, 'replay JSON');
  const report = normalizeEvalReport(parsed);
  if (report) return report.results;
  const run = normalizeTraceRun(parsed);
  if (run) return [resultFromTrace(run)];
  throw new Error(`Replay input is not a supported eval report or trace: ${resolved}`);
}

function summarizeResults(results: EvalScenarioResult[], startedAtMs: number) {
  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const errors = results.filter((result) => result.status === 'error').length;
  const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return {
    total: results.length,
    passed,
    failed,
    errors,
    passRate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
    durationMs: Date.now() - startedAtMs,
    averageToolCalls: Number(average(results.map((result) => result.metrics.toolCallCount)).toFixed(2)),
    averageSteps: Number(average(results.map((result) => result.metrics.stepCount)).toFixed(2)),
  };
}

function resolveEvalOutputPath(evalRunId: string): string {
  const requested = resolve(getArg('out') || `.nova/evals/${evalRunId}/report.json`);
  if (hasFlag('allow-outside-output-dir')) return requested;
  return assertPathUnderDir(
    requested,
    projectNovaDir(),
    'Eval report output path (use --allow-outside-output-dir to override)',
  );
}

async function writeReports(report: EvalReport, outputPath: string, format: EvalReportFormat): Promise<{ jsonPath: string; markdownPath?: string }> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  const written: { jsonPath: string; markdownPath?: string } = { jsonPath: outputPath };
  if (format === 'markdown' || format === 'both') {
    const markdownPath = outputPath.replace(/\.json$/i, '.md');
    await writeFile(markdownPath, renderEvalMarkdown(report), 'utf-8');
    written.markdownPath = markdownPath;
  }
  return written;
}

async function main(): Promise<void> {
  if (hasFlag('list-suites')) {
    console.log(JSON.stringify(listSuites(), null, 2));
    return;
  }

  if (hasFlag('list')) {
    console.log(JSON.stringify(await loadScenarioCatalog(), null, 2));
    return;
  }

  const mode = parseMode();
  const suite = getArg('suite');
  const ids = [...getRepeatedArg('scenario')];
  const positionalArgs = getPositionalArgs();
  const catalog = await loadScenarioCatalog();
  for (const arg of positionalArgs) {
    if (catalog.some((scenario) => scenario.id === arg) && !ids.includes(arg)) ids.push(arg);
  }

  const evalRunId = `eval-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAtMs = Date.now();
  const startedAt = new Date().toISOString();
  const results: EvalScenarioResult[] = [];

  if (mode === 'replay') {
    const replayPath = getArg('replay') ?? positionalArgs[0];
    if (!replayPath) throw new Error('Replay mode requires --replay <report-or-trace-path>');
    results.push(...await loadReplayResults(replayPath));
  } else {
    const scenarios = resolveScenarioSelection(catalog, suite, ids);
    if (!scenarios.length) throw new Error(`No scenarios selected. Available: ${catalog.map((scenario) => scenario.id).join(', ')}`);
    const config = mode === 'live' ? loadEvalConfig(evalRunId) : undefined;
    if (mode === 'live' && !config?.llm.apiKey) throw new Error('LLM_API_KEY not set. Use --mode mock for deterministic offline evals.');

    for (const scenario of scenarios) {
      console.log(chalk.cyan(`▶ ${scenario.id}`), chalk.gray(scenario.name), chalk.gray(`[${mode}]`));
      try {
        const result = mode === 'live' ? await runLiveScenario(scenario, config!) : await runMockScenario(scenario);
        results.push(result);
        console.log(result.status === 'passed' ? chalk.green('  passed') : chalk.red(`  ${result.status}`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          scenarioId: scenario.id,
          name: scenario.name,
          status: 'error',
          durationMs: 0,
          metrics: { stepCount: 0, toolCallCount: 0, uniqueTools: [], finalAnswerChars: 0 },
          checks: [{ name: 'runner_error', passed: false, actual: message }],
          error: message,
        });
        console.log(chalk.red(`  error: ${message}`));
      }
    }
  }

  const report: EvalReport = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    evalRunId,
    startedAt,
    endedAt: new Date().toISOString(),
    mode,
    suite: suite ?? (mode === 'replay' ? 'replay' : undefined),
    summary: summarizeResults(results, startedAtMs),
    results,
  };

  report.gates = evaluateGates(report, parseGateConfig(getArg));
  const baselinePath = getArg('baseline');
  if (baselinePath) report.baseline = await compareWithBaseline(report, baselinePath);

  const outputPath = resolveEvalOutputPath(evalRunId);
  const written = await writeReports(report, outputPath, parseReportFormat());

  if (hasFlag('json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold('Eval summary'));
    console.log(`Mode: ${report.mode} | Suite: ${report.suite ?? 'custom'} | Schema: v${report.schemaVersion}`);
    console.log(`Passed: ${report.summary.passed}/${results.length} | Failed: ${report.summary.failed} | Errors: ${report.summary.errors} | Pass rate: ${Math.round(report.summary.passRate * 100)}%`);
    console.log(`Gates: ${report.gates.passed ? chalk.green('passed') : chalk.red('failed')}`);
    if (report.baseline) console.log(`Baseline: ${report.baseline.passed ? chalk.green('no regression') : chalk.red('regression detected')}`);
    console.log(`JSON report: ${written.jsonPath}`);
    if (written.markdownPath) console.log(`Markdown report: ${written.markdownPath}`);
  }

  if (!report.gates.passed || report.baseline?.passed === false) process.exitCode = 1;
}

main().catch((err) => {
  console.error(chalk.red('Eval failed:'), err instanceof Error ? err.message : err);
  process.exit(1);
});
