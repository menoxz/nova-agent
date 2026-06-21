import type { StepDisplay } from '../types.js';

export type EvalSchemaVersion = 1 | 2;
export type EvalMode = 'live' | 'mock' | 'replay';
export type EvalReportFormat = 'json' | 'markdown' | 'both';
export type EvalToolKind = 'builtin' | 'mcp' | 'lsp' | 'external';

export interface EvalMockSpec {
  steps?: StepDisplay[];
  tools?: string[];
  finalAnswer?: string;
  reasoning?: string;
  durationMs?: number;
}

export interface EvalScenario {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tags: string[];
  /** All listed tools must be used at least once. */
  expectedTools?: string[];
  /** At least one listed tool must be used. Useful when multiple inspection strategies are valid. */
  expectedAnyTools?: string[];
  forbiddenTools?: string[];
  requiredAnswerIncludes?: string[];
  maxToolCalls?: number;
  maxSteps?: number;
  mock?: EvalMockSpec;
}

export interface EvalScenarioResult {
  scenarioId: string;
  name: string;
  status: 'passed' | 'failed' | 'error';
  durationMs: number;
  metrics: {
    stepCount: number;
    toolCallCount: number;
    uniqueTools: string[];
    finalAnswerChars: number;
    toolKinds?: Record<string, EvalToolKind>;
  };
  checks: Array<{
    name: string;
    passed: boolean;
    expected?: unknown;
    actual?: unknown;
  }>;
  finalAnswer?: string;
  error?: string;
}

export interface EvalReport {
  schemaVersion: EvalSchemaVersion;
  evalRunId: string;
  startedAt: string;
  endedAt: string;
  mode: EvalMode;
  suite?: string;
  profile?: {
    id: string;
    version: string;
    hash: string;
    source: 'builtin' | 'custom' | 'imported';
    mode: 'root' | 'subagent' | 'tool_worker';
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    passRate: number;
    durationMs: number;
    averageToolCalls: number;
    averageSteps: number;
  };
  gates?: EvalGateSummary;
  baseline?: EvalBaselineComparison;
  results: EvalScenarioResult[];
}

export interface EvalGateConfig {
  minPassRate: number;
  maxErrors: number;
  maxAverageToolCalls?: number;
  maxScenarioToolCalls?: number;
}

export interface EvalGateResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: unknown;
}

export interface EvalGateSummary {
  passed: boolean;
  config: EvalGateConfig;
  results: EvalGateResult[];
}

export interface EvalBaselineComparison {
  baselinePath: string;
  passed: boolean;
  previousPassRate: number;
  currentPassRate: number;
  previousErrors: number;
  currentErrors: number;
  regressions: Array<{
    scenarioId?: string;
    type: 'new_failure' | 'pass_rate_decrease' | 'error_increase';
    message: string;
  }>;
}
