/**
 * Nova Agent — Tool Registry
 *
 * Central registry for all tools Nova can use.
 * Converts NovaTool definitions to Vercel AI SDK Tool format.
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type { NovaTool, ToolTraceSink } from '../types.js';
import type { ActorContext, DelegationContext, PolicyDecision, PolicyRequest } from '../policy/types.js';
import { evaluatePolicy } from '../policy/engine.js';
import { getPolicyProfile } from '../policy/profiles.js';
import { redactString } from '../policy/redact.js';

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof (value as { type?: unknown }).type === 'string';
}

export class ToolRegistry {
  private tools = new Map<string, NovaTool>();

  register(t: NovaTool): void {
    if (this.tools.has(t.name)) {
      throw new Error(`Tool "${t.name}" is already registered`);
    }
    this.tools.set(t.name, t);
  }

  get(name: string): NovaTool | undefined {
    return this.tools.get(name);
  }

  list(): NovaTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert Nova tools to Vercel AI SDK tool set for generateText()
   */
  toAITools(options: { trace?: ToolTraceSink; policy?: ToolExecutionPolicyHookOptions } = {}): ToolSet {
    const aiTools: ToolSet = {};
    for (const [name, def] of this.tools) {
      aiTools[name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input, executeOptions?: { toolCallId?: string }) => {
          const startedAt = Date.now();
          const toolCallId = executeOptions?.toolCallId;
          options.trace?.recordToolExecutionStart(name, input, toolCallId);
          try {
            const policyDecision = await evaluateToolExecutionPolicy(def, input, options.policy);
            if (policyDecision.decision !== 'allow') {
              const denied = `Policy ${policyDecision.decision} for tool "${name}": ${policyDecision.safeMessage}`;
              options.trace?.recordToolExecutionFinish({
                toolName: name,
                toolCallId,
                durationMs: Date.now() - startedAt,
                ok: false,
                error: new Error(denied),
              });
              return denied;
            }
            const output = await def.execute(input, {
              toolCallId,
              actor: options.policy?.actor,
              delegation: options.policy?.delegation,
            });
            options.trace?.recordToolExecutionFinish({
              toolName: name,
              toolCallId,
              durationMs: Date.now() - startedAt,
              ok: true,
              output,
            });
            return output;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            options.trace?.recordToolExecutionFinish({
              toolName: name,
              toolCallId,
              durationMs: Date.now() - startedAt,
              ok: false,
              error: err,
            });
            return `Error executing tool "${name}": ${msg}`;
          }
        },
        toModelOutput: ({ output }) => {
          if (isToolResultOutput(output)) return output;
          if (typeof output === 'string') return { type: 'text', value: output };
          return { type: 'json', value: output as any };
        },
      });
    }
    return aiTools;
  }

  /**
   * Get a text description of all tools for the system prompt
   */
  getSystemPromptBlock(): string {
    if (this.tools.size === 0) return '';

    const lines: string[] = ['\n## Available Tools\n'];
    for (const [, def] of this.tools) {
      lines.push(`### ${def.name}`);
      lines.push(`Description: ${def.description}`);
      lines.push('');
    }
    return lines.join('\n');
  }
}

export type ToolPolicyHook = (request: PolicyRequest) => PolicyDecision | Promise<PolicyDecision>;

export interface ToolExecutionPolicyHookOptions {
  enabled?: boolean;
  profileId?: string;
  actor?: ActorContext;
  delegation?: DelegationContext;
  hook?: ToolPolicyHook;
  approvalProvided?: boolean;
}

function defaultPolicyOptions(options?: ToolExecutionPolicyHookOptions): ToolExecutionPolicyHookOptions {
  return {
    enabled: options?.enabled ?? true,
    profileId: options?.profileId ?? 'readonly',
    actor: options?.actor,
    delegation: options?.delegation,
    hook: options?.hook,
    approvalProvided: options?.approvalProvided,
  };
}

function inferPathInputs(input: unknown): { path?: string; paths?: string[]; contentPreview?: string } {
  if (!input || typeof input !== 'object') return {};
  const record = input as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : typeof record.cwd === 'string' ? record.cwd : typeof record.workdir === 'string' ? record.workdir : typeof record.root === 'string' ? record.root : undefined;
  const paths = Array.isArray(record.paths) ? record.paths.filter((value): value is string => typeof value === 'string') : undefined;
  const contentPreview = typeof record.content === 'string' ? record.content.slice(0, 4_000) : typeof record.stdin === 'string' ? record.stdin.slice(0, 4_000) : undefined;
  return { path, paths, contentPreview };
}

function defaultActor(): ActorContext {
  return { actorId: 'nova-root-agent', actorType: 'root_agent' };
}

async function evaluateToolExecutionPolicy(def: NovaTool, input: unknown, options?: ToolExecutionPolicyHookOptions): Promise<PolicyDecision> {
  const policyOptions = defaultPolicyOptions(options);
  if (!policyOptions.enabled && !policyOptions.hook) {
    return { decision: 'allow', ruleId: 'tool-policy-hook-disabled', reason: 'no ToolRegistry policy hook configured', safeMessage: 'ToolRegistry policy hook disabled' };
  }
  const profile = getPolicyProfile(policyOptions.profileId ?? 'readonly');
  const request: PolicyRequest = {
    actor: policyOptions.actor ?? defaultActor(),
    delegation: policyOptions.delegation,
    profileId: profile.id,
    capability: def.capability ?? (def.readOnly === false ? 'write' : 'read'),
    action: `tool:${def.name}`,
    toolName: def.name,
    input: undefined,
    readOnly: def.readOnly,
    riskLevel: def.riskLevel,
    ...inferPathInputs(input),
  };
  const decision = policyOptions.hook ? await policyOptions.hook(request) : evaluatePolicy(request, { profile });
  if (decision.decision === 'ask' && policyOptions.approvalProvided === true) {
    return { decision: 'allow', ruleId: decision.ruleId, reason: `approved request: ${decision.reason}`, safeMessage: 'Nova policy allow: approved request' };
  }
  if (decision.decision === 'ask') {
    return { ...decision, safeMessage: redactString(`${decision.safeMessage}; execution blocked because no approval integration approved this request`, 1_000) };
  }
  return decision;
}
