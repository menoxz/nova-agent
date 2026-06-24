import { defaultScenarios } from './scenarios.js';
import type { EvalScenario } from './types.js';

export const evalSuites = {
  smoke: ['targeted-file-read'],
  core: ['repo-orientation', 'targeted-file-read', 'safe-git-status'],
  safety: ['safe-git-status'],
  policy: ['policy-core-v1'],
  profiles: ['profiles-v1-foundation'],
  mcp: ['mcp-readonly-denylist', 'mcp-v1-1-curated-metadata', 'mcp-v1-1-path-denial-matrix', 'mcp-v1-1-redaction-output-caps', 'mcp-v1-1-disabled-tools-curated-surface', 'mcp-v1-1-sanitized-observability-resources', 'mcp-v1-1-resource-schema-versioning', 'mcp-v1-1-release-readiness-compatibility', 'mcp-v1-1-gated-tools-policy'],
  lsp: ['lsp-readonly-metadata'],
  subagents: ['subagents-v1-safety-values'],
  memory: ['memory-v1-foundation'],
  context: ['context-builder-v1'],
  tokens: ['token-management-v1'],
  session: ['session-run-manager-v1'],
  approval: ['approval-manager-v1'],
  'run-replay': ['run-replay-resume-v1'],
  conversation: ['conversation-persistence-v1'],
  current: ['current-session-ux-v1'],
  config: ['config-file-v1'],
  streaming: ['streaming-ux-v1'],
  llm: ['llm-robustness-v1'],
  cli: ['cli-help-command-ux-v1'],
  batch: ['batch-mode-v1'],
  heartbeat: ['heartbeat-autonomous-tasks-v1-safe-slice'],
  tui: ['tui-prototype-v0'],
  release: ['release-versioning-v1'],
  quality: ['quality-gate-v1'],
  providers: ['provider-profiles-v1'],
  'provider-readiness': ['provider-live-smoke-readiness-v1'],
  report: ['eval-report-trend-v1'],
  slo: ['eval-slo-dashboard-v1'],
} as const;

export type EvalSuiteName = keyof typeof evalSuites;

export function isEvalSuiteName(value: string): value is EvalSuiteName {
  return Object.hasOwn(evalSuites, value);
}

export function listSuites(): Array<{ name: EvalSuiteName; scenarioIds: string[] }> {
  return Object.entries(evalSuites).map(([name, scenarioIds]) => ({
    name: name as EvalSuiteName,
    scenarioIds: [...scenarioIds],
  }));
}

export function resolveScenarioSelection(catalog: EvalScenario[], suiteName?: string, ids: string[] = []): EvalScenario[] {
  const selectedIds = new Set<string>();
  if (suiteName) {
    if (!isEvalSuiteName(suiteName)) {
      throw new Error(`Unknown suite "${suiteName}". Available suites: ${Object.keys(evalSuites).join(', ')}`);
    }
    for (const id of evalSuites[suiteName]) selectedIds.add(id);
  }
  for (const id of ids) selectedIds.add(id);
  if (!selectedIds.size) return catalog;
  return catalog.filter((scenario) => selectedIds.has(scenario.id));
}

export function defaultScenarioIds(): string[] {
  return defaultScenarios.map((scenario) => scenario.id);
}
