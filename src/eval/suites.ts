import { defaultScenarios } from './scenarios.js';
import type { EvalScenario } from './types.js';

export const evalSuites = {
  smoke: ['targeted-file-read'],
  core: ['repo-orientation', 'targeted-file-read', 'safe-git-status'],
  safety: ['safe-git-status'],
  policy: ['policy-core-v1'],
  mcp: ['mcp-readonly-denylist'],
  lsp: ['lsp-readonly-metadata'],
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
