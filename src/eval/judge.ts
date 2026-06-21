import type { StepDisplay } from '../types.js';
import type { EvalScenario, EvalScenarioResult } from './types.js';

export function judgeScenario(scenario: EvalScenario, steps: StepDisplay[], durationMs: number): EvalScenarioResult {
  const toolCalls = steps.filter((step) => step.type === 'tool_call');
  const finalAnswer = [...steps].reverse().find((step) => step.type === 'answer')?.content ?? '';
  const usedTools = toolCalls.map((step) => step.toolName).filter((name): name is string => Boolean(name));
  const uniqueTools = Array.from(new Set(usedTools)).sort();
  const checks: EvalScenarioResult['checks'] = [];

  checks.push({
    name: 'final_answer_non_empty',
    passed: finalAnswer.trim().length > 0 && !finalAnswer.trimStart().startsWith('✖ Error:'),
    actual: finalAnswer.slice(0, 200),
  });

  for (const toolName of scenario.expectedTools ?? []) {
    checks.push({
      name: `expected_tool:${toolName}`,
      passed: usedTools.includes(toolName),
      expected: toolName,
      actual: uniqueTools,
    });
  }

  if (scenario.expectedAnyTools?.length) {
    checks.push({
      name: 'expected_any_tool',
      passed: scenario.expectedAnyTools.some((toolName) => usedTools.includes(toolName)),
      expected: scenario.expectedAnyTools,
      actual: uniqueTools,
    });
  }

  for (const toolName of scenario.forbiddenTools ?? []) {
    checks.push({
      name: `forbidden_tool:${toolName}`,
      passed: !usedTools.includes(toolName),
      expected: `not ${toolName}`,
      actual: uniqueTools,
    });
  }

  if (typeof scenario.maxToolCalls === 'number') {
    checks.push({
      name: 'max_tool_calls',
      passed: toolCalls.length <= scenario.maxToolCalls,
      expected: `<= ${scenario.maxToolCalls}`,
      actual: toolCalls.length,
    });
  }

  if (typeof scenario.maxSteps === 'number') {
    checks.push({
      name: 'max_steps',
      passed: steps.length <= scenario.maxSteps * 3 + 1,
      expected: `display steps bounded by ${scenario.maxSteps} ReAct steps`,
      actual: steps.length,
    });
  }

  for (const expectedText of scenario.requiredAnswerIncludes ?? []) {
    checks.push({
      name: `answer_includes:${expectedText}`,
      passed: finalAnswer.toLowerCase().includes(expectedText.toLowerCase()),
      expected: expectedText,
      actual: finalAnswer.slice(0, 400),
    });
  }

  const passed = checks.every((check) => check.passed);
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    status: passed ? 'passed' : 'failed',
    durationMs,
    metrics: {
      stepCount: steps.length,
      toolCallCount: toolCalls.length,
      uniqueTools,
      finalAnswerChars: finalAnswer.length,
    },
    checks,
    finalAnswer,
  };
}
