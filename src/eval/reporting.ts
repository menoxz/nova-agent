import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { normalizeEvalReport } from './schema.js';
import type { EvalGateSummary, EvalReport, EvalScenarioResult } from './types.js';
import { assertPathUnderDir, isPathInside, projectNovaDir, readJsonFileBounded } from '../utils/safe_io.js';

const SAFE_RUN_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;
const MAX_ERROR_CHARS = 240;

export interface EvalReportingOptions {
  projectRoot?: string;
}

export interface EvalRunListItem {
  evalRunId: string;
  mode: string;
  suite: string;
  startedAt: string;
  endedAt: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  gates: 'passed' | 'failed' | 'missing';
  reportPath: string;
}

export interface SafeFailedScenario {
  scenarioId: string;
  name: string;
  status: 'failed' | 'error';
  error?: string;
  failedChecks: string[];
}

export interface SafeEvalReportSummary extends EvalRunListItem {
  schemaVersion: number;
  averageToolCalls: number;
  averageSteps: number;
  durationMs: number;
  gatesDetail?: SafeGateSummary;
  failedScenarios: SafeFailedScenario[];
}

export interface SafeGateSummary {
  passed: boolean;
  results: Array<{
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
  }>;
}

export interface EvalCompareSummary {
  previous: SafeEvalReportSummary;
  current: SafeEvalReportSummary;
  deltas: {
    passRate: number;
    passed: number;
    failed: number;
    errors: number;
    total: number;
  };
  failedBefore: SafeFailedScenario[];
  failedAfter: SafeFailedScenario[];
  newlyFailed: SafeFailedScenario[];
  recovered: SafeFailedScenario[];
  gates: {
    previous: 'passed' | 'failed' | 'missing';
    current: 'passed' | 'failed' | 'missing';
    changed: boolean;
  };
}

export function evalsRoot(projectRoot = process.cwd()): string {
  return assertPathUnderDir(resolve(projectNovaDir(projectRoot), 'evals'), projectNovaDir(projectRoot), 'Eval reports directory');
}

export function assertSafeEvalRunId(evalRunId: string): string {
  if (!SAFE_RUN_ID_RE.test(evalRunId) || evalRunId.includes('/') || evalRunId.includes('\\') || evalRunId.includes('..')) {
    throw new Error(`Invalid eval run id: ${evalRunId}. Use 1-120 letters, numbers, dot, underscore or dash; path separators are not allowed.`);
  }
  return evalRunId;
}

export function reportJsonPath(evalRunId: string, options: EvalReportingOptions = {}): string {
  const root = evalsRoot(options.projectRoot);
  const safeId = assertSafeEvalRunId(evalRunId);
  return assertPathUnderDir(resolve(root, safeId, 'report.json'), root, 'Eval report path');
}

export async function loadEvalReport(evalRunId: string, options: EvalReportingOptions = {}): Promise<{ report: EvalReport; path: string }> {
  const safeId = assertSafeEvalRunId(evalRunId);
  const path = reportJsonPath(evalRunId, options);
  const report = normalizeEvalReport(await readJsonFileBounded(path, 'eval report.json'));
  if (!report) throw new Error(`Invalid eval report.json: ${path}`);
  if (report.evalRunId !== safeId) throw new Error(`Eval report id mismatch in ${path}: expected ${safeId}`);
  return { report, path };
}

export async function listEvalReports(options: EvalReportingOptions & { limit?: number } = {}): Promise<EvalRunListItem[]> {
  const root = evalsRoot(options.projectRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const items: EvalRunListItem[] = [];
  for (const entry of entries.sort()) {
    if (!SAFE_RUN_ID_RE.test(entry)) continue;
    try {
      const { report, path } = await loadEvalReport(entry, options);
      items.push(toListItem(report, path));
    } catch {
      // Ignore directories without a valid structured report.json. Never inspect report.md, traces, or prompts.
    }
  }

  items.sort((a, b) => sortTimestamp(b).localeCompare(sortTimestamp(a)) || b.evalRunId.localeCompare(a.evalRunId));
  return typeof options.limit === 'number' ? items.slice(0, options.limit) : items;
}

export async function latestEvalReport(options: EvalReportingOptions = {}): Promise<{ report: EvalReport; path: string }> {
  const [latest] = await listEvalReports({ ...options, limit: 1 });
  if (!latest) throw new Error(`No eval reports found under ${evalsRoot(options.projectRoot)}. Run an eval first or pass a specific evalRunId.`);
  return loadEvalReport(latest.evalRunId, options);
}

export async function resolveEvalReport(selector: string, options: EvalReportingOptions = {}): Promise<{ report: EvalReport; path: string }> {
  return selector === 'latest' ? latestEvalReport(options) : loadEvalReport(selector, options);
}

export function summarizeEvalReport(report: EvalReport, path: string): SafeEvalReportSummary {
  const listItem = toListItem(report, path);
  return {
    ...listItem,
    schemaVersion: report.schemaVersion,
    averageToolCalls: safeNumber(report.summary.averageToolCalls),
    averageSteps: safeNumber(report.summary.averageSteps),
    durationMs: safeNumber(report.summary.durationMs),
    gatesDetail: report.gates ? sanitizeGates(report.gates) : undefined,
    failedScenarios: failedScenarios(report.results),
  };
}

export function compareEvalReports(previous: EvalReport, previousPath: string, current: EvalReport, currentPath: string): EvalCompareSummary {
  const previousSummary = summarizeEvalReport(previous, previousPath);
  const currentSummary = summarizeEvalReport(current, currentPath);
  const failedBefore = previousSummary.failedScenarios;
  const failedAfter = currentSummary.failedScenarios;
  const beforeIds = new Set(failedBefore.map((scenario) => scenario.scenarioId));
  const afterIds = new Set(failedAfter.map((scenario) => scenario.scenarioId));
  return {
    previous: previousSummary,
    current: currentSummary,
    deltas: {
      passRate: round4(currentSummary.passRate - previousSummary.passRate),
      passed: currentSummary.passed - previousSummary.passed,
      failed: currentSummary.failed - previousSummary.failed,
      errors: currentSummary.errors - previousSummary.errors,
      total: currentSummary.total - previousSummary.total,
    },
    failedBefore,
    failedAfter,
    newlyFailed: failedAfter.filter((scenario) => !beforeIds.has(scenario.scenarioId)),
    recovered: failedBefore.filter((scenario) => !afterIds.has(scenario.scenarioId)),
    gates: {
      previous: previousSummary.gates,
      current: currentSummary.gates,
      changed: previousSummary.gates !== currentSummary.gates,
    },
  };
}

export function renderEvalReportText(summary: SafeEvalReportSummary): string {
  const lines = [
    `Eval report ${summary.evalRunId}`,
    `Mode: ${summary.mode} | Suite: ${summary.suite} | Schema: v${summary.schemaVersion}`,
    `Started: ${summary.startedAt} | Ended: ${summary.endedAt}`,
    `Passed: ${summary.passed}/${summary.total} | Failed: ${summary.failed} | Errors: ${summary.errors} | Pass rate: ${formatPercent(summary.passRate)}`,
    `Average tool calls: ${summary.averageToolCalls} | Average steps: ${summary.averageSteps} | Duration: ${summary.durationMs}ms`,
    `Gates: ${summary.gates}`,
    `Report JSON: ${summary.reportPath}`,
  ];
  if (summary.gatesDetail?.results.length) {
    lines.push('', 'Gates detail:');
    for (const gate of summary.gatesDetail.results) lines.push(`- ${gate.name}: ${gate.passed ? 'passed' : 'failed'} (expected=${gate.expected}; actual=${gate.actual})`);
  }
  if (summary.failedScenarios.length) {
    lines.push('', 'Failed scenarios:');
    for (const scenario of summary.failedScenarios) lines.push(`- ${scenario.scenarioId} (${scenario.status}) ${scenario.name}${scenario.error ? ` — ${scenario.error}` : ''}${scenario.failedChecks.length ? ` [checks: ${scenario.failedChecks.join(', ')}]` : ''}`);
  } else {
    lines.push('', 'Failed scenarios: none');
  }
  return `${lines.join('\n')}\n`;
}

export function renderEvalSummaryMarkdown(summary: SafeEvalReportSummary): string {
  const lines = [
    `# Nova Eval Summary — ${escapeMarkdown(summary.evalRunId)}`,
    '',
    `- Mode: ${escapeMarkdown(summary.mode)}`,
    `- Suite: ${escapeMarkdown(summary.suite)}`,
    `- Started: ${escapeMarkdown(summary.startedAt)}`,
    `- Ended: ${escapeMarkdown(summary.endedAt)}`,
    `- Pass rate: ${formatPercent(summary.passRate)} (${summary.passed}/${summary.total})`,
    `- Failed: ${summary.failed}`,
    `- Errors: ${summary.errors}`,
    `- Gates: ${summary.gates}`,
    '',
    '## Failed scenarios',
    '',
  ];
  if (!summary.failedScenarios.length) lines.push('- None');
  for (const scenario of summary.failedScenarios) {
    lines.push(`- **${escapeMarkdown(scenario.scenarioId)}** (${scenario.status}) — ${escapeMarkdown(scenario.name)}${scenario.error ? ` — ${escapeMarkdown(scenario.error)}` : ''}`);
  }
  if (summary.gatesDetail?.results.length) {
    lines.push('', '## Gates', '', '| Gate | Status | Expected | Actual |', '| --- | --- | --- | --- |');
    for (const gate of summary.gatesDetail.results) lines.push(`| ${tableCell(gate.name)} | ${gate.passed ? 'passed' : 'failed'} | ${tableCell(gate.expected)} | ${tableCell(gate.actual)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderEvalCompareMarkdown(compare: EvalCompareSummary): string {
  const lines = [
    `# Nova Eval Compare — ${escapeMarkdown(compare.previous.evalRunId)} → ${escapeMarkdown(compare.current.evalRunId)}`,
    '',
    '| Metric | Previous | Current | Delta |',
    '| --- | ---: | ---: | ---: |',
    `| Pass rate | ${formatPercent(compare.previous.passRate)} | ${formatPercent(compare.current.passRate)} | ${formatSignedPercent(compare.deltas.passRate)} |`,
    `| Passed | ${compare.previous.passed} | ${compare.current.passed} | ${formatSigned(compare.deltas.passed)} |`,
    `| Failed | ${compare.previous.failed} | ${compare.current.failed} | ${formatSigned(compare.deltas.failed)} |`,
    `| Errors | ${compare.previous.errors} | ${compare.current.errors} | ${formatSigned(compare.deltas.errors)} |`,
    `| Total | ${compare.previous.total} | ${compare.current.total} | ${formatSigned(compare.deltas.total)} |`,
    '',
    `- Gates: ${compare.gates.previous} → ${compare.gates.current}${compare.gates.changed ? ' (changed)' : ''}`,
    '',
    '## Newly failed',
    '',
    ...scenarioLines(compare.newlyFailed),
    '',
    '## Recovered',
    '',
    ...scenarioLines(compare.recovered),
    '',
    '## Current failed scenarios',
    '',
    ...scenarioLines(compare.failedAfter),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function writeMarkdownOutput(path: string, content: string, options: EvalReportingOptions = {}): Promise<string> {
  const resolved = resolve(path);
  const root = evalsRoot(options.projectRoot);
  if (isPathInside(resolved, root)) throw new Error(`--out must not write under existing eval reports directory: ${root}`);
  if (!isAbsolute(resolved) && relative(process.cwd(), resolved).startsWith('..')) throw new Error(`--out must stay in the current workspace or use an absolute path: ${path}`);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf-8');
  return resolved;
}

function toListItem(report: EvalReport, path: string): EvalRunListItem {
  return {
    evalRunId: report.evalRunId,
    mode: report.mode ?? 'live',
    suite: report.suite ?? 'custom',
    startedAt: report.startedAt ?? '',
    endedAt: report.endedAt ?? '',
    total: safeNumber(report.summary.total),
    passed: safeNumber(report.summary.passed),
    failed: safeNumber(report.summary.failed),
    errors: safeNumber(report.summary.errors),
    passRate: round4(safeNumber(report.summary.passRate)),
    gates: gateStatus(report.gates),
    reportPath: path,
  };
}

function sortTimestamp(item: EvalRunListItem): string {
  return item.endedAt || item.startedAt || item.evalRunId;
}

function failedScenarios(results: EvalScenarioResult[]): SafeFailedScenario[] {
  return results
    .filter((result) => result.status === 'failed' || result.status === 'error')
    .map((result) => ({
      scenarioId: result.scenarioId,
      name: result.name,
      status: (result.status === 'error' ? 'error' : 'failed') as 'error' | 'failed',
      error: result.error ? truncate(redact(String(result.error)), MAX_ERROR_CHARS) : undefined,
      failedChecks: (result.checks ?? []).filter((check) => !check.passed).map((check) => check.name).sort(),
    }))
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

function sanitizeGates(gates: EvalGateSummary): SafeGateSummary {
  return {
    passed: gates.passed,
    results: gates.results.map((gate) => ({
      name: gate.name,
      passed: gate.passed,
      expected: truncate(redact(gate.expected), 120),
      actual: truncate(redact(formatGateActual(gate.actual)), 120),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function formatGateActual(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return String(value);
  try { return JSON.stringify(value); } catch { return '[unserializable]'; }
}

function gateStatus(gates?: EvalGateSummary): 'passed' | 'failed' | 'missing' {
  if (!gates) return 'missing';
  return gates.passed ? 'passed' : 'failed';
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value * 10000) / 100}%`;
}

function scenarioLines(scenarios: SafeFailedScenario[]): string[] {
  if (!scenarios.length) return ['- None'];
  return scenarios.map((scenario) => `- **${escapeMarkdown(scenario.scenarioId)}** (${scenario.status}) — ${escapeMarkdown(scenario.name)}${scenario.error ? ` — ${escapeMarkdown(scenario.error)}` : ''}`);
}

function redact(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
    .replace(/(api[_-]?key|token|password|passwd|secret|private[_-]?key|credential|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi, (_match, key: string) => `${key}=[REDACTED]`);
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|-])/g, '\\$1');
}

function tableCell(value: string): string {
  return escapeMarkdown(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
