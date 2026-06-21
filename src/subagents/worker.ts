import { ToolRegistry } from '../tools/registry.js';
import { NovaAgent } from '../agent.js';
import type { AgentConfig, NovaTool, StepDisplay } from '../types.js';
import type { PolicyDecision } from '../policy/types.js';
import { assertBudgetAvailable, createBudgetState, recordBudgetUsage } from './budget.js';
import { assertNoRecursiveDelegation, assertProducerCannotSelfVerify, assertStructuredReport } from './contracts.js';
import { buildScopedContext } from './context.js';
import { createDelegationContext, deriveEffectiveGrant } from './delegation.js';
import { createSubagentReport } from './reporter.js';
import { getSubagentRole } from './registry.js';
import { applyProfileToConfig, resolveProfileSync } from '../profiles/index.js';
import type { WorkerRunInput, WorkerRunResult } from './types.js';

const FORBIDDEN_CHILD_TOOL_NAMES = /(?:^|[_:-])(subagent|subagents|orchestrator|delegate|delegation)(?:$|[_:-])/i;

function scopedRegistry(source: ToolRegistry, allowedTools: string[], budget: ReturnType<typeof createBudgetState>, denial: (reason: string) => PolicyDecision): ToolRegistry {
  const registry = new ToolRegistry();
  for (const toolName of allowedTools) {
    if (FORBIDDEN_CHILD_TOOL_NAMES.test(toolName)) throw new Error(`Sub-agent child registry cannot include recursive delegation tool: ${toolName}`);
  }
  for (const tool of source.list()) {
    if (!allowedTools.includes(tool.name)) continue;
    if (FORBIDDEN_CHILD_TOOL_NAMES.test(tool.name)) continue;
    const wrapped: NovaTool = {
      ...tool,
      execute: async (input, options) => {
        if (!options?.actor || !options.delegation) throw new Error('Sub-agent tool call missing actor/delegation context');
        assertBudgetAvailable(budget);
        const output = await tool.execute(input, options);
        recordBudgetUsage(budget, output);
        return output;
      },
    };
    registry.register(wrapped);
  }
  void denial;
  return registry;
}

export class SubagentWorker {
  constructor(private readonly baseConfig: AgentConfig, private readonly tools: ToolRegistry) {}

  async run(input: WorkerRunInput): Promise<WorkerRunResult> {
    assertNoRecursiveDelegation(input.task);
    assertProducerCannotSelfVerify(input.task);
    const role = getSubagentRole(input.task.role);
    const grant = deriveEffectiveGrant({
      parentGrant: input.parentGrant,
      roleId: input.task.role,
      requested: input.task.requestedGrant,
      policyProfileId: input.policyProfileId,
    });
    const { actor, delegation } = createDelegationContext({ task: input.task, parentActor: input.parentActor, grant });
    const budget = createBudgetState(input.task.budget);
    const context = input.context ?? await buildScopedContext({ root: input.root, allowlist: input.task.scope ?? [], maxTotalBytes: budget.maxOutputChars });
    const childTools = scopedRegistry(this.tools, grant.tools, budget, (reason) => ({ decision: 'deny', ruleId: 'subagent-worker', reason, safeMessage: reason }));
    const childProfile = resolveProfileSync({ profileId: input.task.profileId ?? input.task.profileMetadata?.id ?? role.defaultProfileId, mode: 'subagent' });
    const childConfig: AgentConfig = applyProfileToConfig({
      ...this.baseConfig,
      maxSteps: Math.min(this.baseConfig.maxSteps ?? 15, budget.maxToolCalls + 2),
      systemPrompt: [
        this.baseConfig.systemPrompt,
        '',
        `You are a bounded Nova sub-agent role=${role.id}. You cannot spawn sub-agents.`,
        'Return facts in a structured report mindset: summary, findings, evidence, risks. Do not expose secrets or raw .nova artifacts.',
        `Scoped context files: ${context.resources.map((resource) => resource.safePath).join(', ') || '(none)'}`,
      ].join('\n'),
      policy: {
        enabled: this.baseConfig.policy?.enabled ?? true,
        profileId: grant.profileId,
        actor,
        delegation,
        approvalProvided: false,
      },
    }, childProfile);
    const prompt = [input.task.prompt, '', 'Use only allowlisted tools/context. Produce the mandatory structured report content.'].join('\n');
    let steps: StepDisplay[];
    try {
      steps = await new NovaAgent(childConfig, childTools).run(prompt);
    } catch (err) {
      steps = [{ type: 'answer', content: err instanceof Error ? err.message : String(err) }];
    }
    const report = createSubagentReport({ task: input.task, role: role.id, steps, budget, context });
    assertStructuredReport(report);
    return { task: input.task, actor, delegation, grant, report };
  }
}
