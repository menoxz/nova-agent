/**
 * Nova Agent — Core Agent Loop (ReAct)
 *
 * Implements the Reasoning + Acting loop:
 *   System Prompt → LLM → Tool Calls → Execute → Observe → LLM → ... → Answer
 *
 * Uses Vercel AI SDK v6+ for LLM interaction and tool handling.
 */

import { generateText, streamText, stepCountIs } from 'ai';
import type { ToolSet } from 'ai';
import chalk from 'chalk';

import type { AgentConfig, StepDisplay } from './types.js';
import { ToolRegistry } from './tools/registry.js';
import { ConversationMemory, userMessage, toolResultMessage } from './memory/conversation.js';
import { createModel } from './llm/provider.js';
import { createTraceRecorder } from './trace/recorder.js';
import { buildAgentContext } from './context/index.js';
import { extractTokenUsage, responseTokenMetrics } from './tokens/index.js';
import { ConversationStore, CurrentSessionStore, SessionRunManager, type RunRecord, type SessionRecord } from './session/index.js';
import { createApprovalPolicyHook } from './approval/index.js';
import { estimateTokens } from './tokens/metrics.js';
import { safePreview, estimatedLiveCost } from './streaming/utils.js';
import type { AgentRunOptions } from './streaming/types.js';
import { RuntimeEventEmitter } from './streaming/events.js';

function summarizeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output.slice(0, 500);
  if (typeof output === 'object' && output !== null && 'type' in output) {
    const typed = output as { type?: string; value?: unknown };
    if (typed.type === 'content' && Array.isArray(typed.value)) {
      return typed.value.map((part: any) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'image-data') return `[image-data ${part.mediaType}, base64 omitted]`;
        if (part.type === 'file-data') return `[file-data ${part.filename ?? 'file'} ${part.mediaType}, base64 omitted]`;
        if (part.type === 'image-url') return `[image-url ${part.url}]`;
        if (part.type === 'file-url') return `[file-url ${part.url}]`;
        return `[${part.type ?? 'content-part'}]`;
      }).join('\n').slice(0, 500);
    }
    return JSON.stringify(output, (_key, value) => {
      if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 80)}...(omitted ${value.length} chars)`;
      return value;
    }).slice(0, 500);
  }
  return String(output).slice(0, 500);
}

export class NovaAgent {
  public readonly config: AgentConfig;
  public readonly tools: ToolRegistry;
  public readonly memory: ConversationMemory;

  private model: ReturnType<typeof createModel>;

  constructor(config: AgentConfig, tools: ToolRegistry) {
    this.config = config;
    this.tools = tools;
    this.memory = new ConversationMemory();
    this.model = createModel(config.llm);
  }

  /**
   * Run a full interaction: user message → agent loop → final answer
   */
  async run(input: string, options: AgentRunOptions = {}): Promise<StepDisplay[]> {
    const steps: StepDisplay[] = [];
    const maxSteps = this.config.maxSteps ?? 15;
    let sessionManager: SessionRunManager | undefined;
    let activeSession: SessionRecord | undefined;
    let activeRun: RunRecord | undefined;
    const activeRunRef: { sessionId?: string; runId?: string } = {};
    let eventEmitter = new RuntimeEventEmitter();
    const emit = async (payload: import('./streaming/types.js').StreamingEventPayload, eventOptions?: Parameters<RuntimeEventEmitter['create']>[1]) => { await options.onEvent?.(eventEmitter.create(payload, eventOptions)); };

    if (this.config.session?.enabled) {
      try {
        sessionManager = new SessionRunManager(this.config.session);
        activeSession = await sessionManager.getOrCreateSession({
          title: this.config.session.title ?? 'Nova interactive session',
          objective: input,
          profileId: this.config.profile?.id,
          projectId: this.config.session.projectId,
          userId: this.config.session.userId,
          tags: ['agent-run'],
        });
        activeRun = await sessionManager.startRun({
          sessionId: activeSession.id,
          objective: input,
          input,
          budget: this.config.session.defaultBudget,
        });
        activeRunRef.sessionId = activeRun.sessionId;
        activeRunRef.runId = activeRun.id;
        eventEmitter = new RuntimeEventEmitter({ sessionId: activeRun.sessionId, runId: activeRun.id });
        await new CurrentSessionStore(this.config.session).set({ sessionId: activeRun.sessionId, runId: activeRun.id, source: 'agent', validate: false }).catch(() => undefined);
      } catch {
        sessionManager = undefined;
        activeSession = undefined;
        activeRun = undefined;
      }
    }

    const runConfig: AgentConfig = activeSession ? { ...this.config, session: { ...this.config.session, defaultSessionId: activeSession.id } } : this.config;
    const context = await buildAgentContext({
      input,
      baseSystemPrompt: this.buildSystemPrompt(),
      config: runConfig,
      tools: this.tools.list(this.config.toolConstraints),
    });
    const systemPrompt = context.systemPrompt;
    const estimatedPromptTokens = estimateTokens(`${systemPrompt}\n${JSON.stringify(this.memory.getMessages())}\n${input}`);
    if (options.streaming) await emit({ type: 'start', model: this.config.llm.model, estimatedPromptTokens });
    if (sessionManager && activeRun) {
      await sessionManager.recordEvent(activeRun.sessionId, activeRun.id, 'context_built', 'Context Builder completed', { usedTokens: context.budget.usedTokens, remainingTokens: context.budget.remainingTokens, retrievedMemory: context.memorySummary.retrievedCount }).catch(() => undefined);
    }
    const trace = createTraceRecorder({
      input,
      model: this.config.llm.model,
      maxSteps,
      toolNames: this.tools.list(this.config.toolConstraints).map((t) => t.name),
      memory: context.memorySummary,
      context: context.budget,
    }, this.config.trace);
    const toolSet = this.tools.toAITools({
      trace,
      policy: {
        enabled: this.config.policy?.enabled ?? true,
        profileId: this.config.policy?.profileId ?? 'readonly',
        actor: this.config.policy?.actor,
        delegation: this.config.policy?.delegation,
        approvalProvided: this.config.policy?.approvalProvided,
        hook: this.config.session?.enabled ? createApprovalPolicyHook(this.config.session, activeRunRef) : undefined,
      },
      constraints: this.config.toolConstraints,
    });

    // Add user message to memory
    this.memory.add(userMessage(input));
    const messages = this.memory.getMessages();

    try {
      const responseStartedAt = Date.now();
      const handleStepFinish = (step: any) => {
        trace?.recordLlmStep({
          text: step.text,
          toolCallCount: step.toolCalls?.length ?? 0,
          toolResultCount: step.toolResults?.length ?? 0,
        });

        if (step.text && step.toolCalls?.length) {
          steps.push({ type: 'reasoning', content: step.text });
        }

        if (step.toolCalls?.length) {
          for (const tc of step.toolCalls) {
            trace?.recordToolCall(tc.toolCallId, tc.toolName, tc.input);
            steps.push({ type: 'tool_call', content: `Calling ${tc.toolName}(${JSON.stringify(tc.input)})`, toolName: tc.toolName, toolArgs: tc.input as Record<string, unknown> });
          }
        }

        if (step.toolResults?.length) {
          for (const tr of step.toolResults) {
            const outputStr = summarizeToolOutput(tr.output);
            trace?.recordToolResult(tr.toolCallId, tr.toolName, tr.output);
            steps.push({ type: 'tool_result', content: outputStr, toolName: tr.toolName, toolResult: outputStr });
            this.memory.add(toolResultMessage(tr.toolCallId, tr.toolName, tr.output));
          }
        }
      };

      const result = options.streaming ? await this.runStreaming({ systemPrompt, messages, toolSet, maxSteps, responseStartedAt, estimatedPromptTokens, onStepFinish: handleStepFinish, emit }) : await generateText({
        model: this.model,
        system: systemPrompt,
        messages,
        tools: toolSet,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: handleStepFinish,
      });

      // Add assistant's final response to memory
      const finalText = (await Promise.resolve(result.text)) || '(no response)';
      const providerUsage = options.streaming
        ? await Promise.resolve((result as { totalUsage?: PromiseLike<unknown> }).totalUsage).then((usage) => extractTokenUsage({ totalUsage: usage })).catch(() => undefined)
        : extractTokenUsage(result);
      const tokenMetrics = responseTokenMetrics({
        usage: providerUsage,
        promptText: `${systemPrompt}\n${JSON.stringify(messages)}`,
        completionText: finalText,
        responseDurationMs: Date.now() - responseStartedAt,
        pricing: this.config.llm.pricing,
      });
      if (options.streaming) {
        await emit({ type: 'finish', text: finalText, metrics: tokenMetrics, elapsedMs: Date.now() - responseStartedAt, toolCallCount: steps.filter((step) => step.type === 'tool_call').length });
      }
      trace?.recordFinalAnswer(finalText, tokenMetrics);
      this.memory.add({
        role: 'assistant',
        content: [{ type: 'text', text: finalText }],
      });

      // Push final answer (no duplicate: reasoning only pushed when tools were used)
      steps.push({
        type: 'answer',
        content: finalText,
      });

      const traceResult = await trace?.finish('success');
      if (sessionManager && activeRun) {
        const finishedRun = await sessionManager.finishRun(activeRun.sessionId, activeRun.id, {
          status: 'succeeded',
          summary: finalText,
          tokenMetrics,
          toolCalls: steps.filter((step) => step.type === 'tool_call').length,
          observability: {
            traceRunId: trace?.runId,
            tracePath: traceResult?.outputPath,
            memory: context.memorySummary,
            context: context.budget,
          },
        }).catch(() => undefined);
        if (finishedRun) await new ConversationStore(runConfig.session).addTurn({ sessionId: activeRun.sessionId, run: finishedRun, userInput: input, assistantText: finalText, toolCallCount: steps.filter((step) => step.type === 'tool_call').length }).catch(() => undefined);
      }
      return steps;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (options.streaming) await emit({ type: 'error', message: errorMsg, elapsedMs: 0 });
      trace?.recordError(err);
      steps.push({
        type: 'answer',
        content: chalk.red(`\n✖ Error: ${errorMsg}`),
      });
      const traceResult = await trace?.finish('error');
      if (sessionManager && activeRun) {
        const finishedRun = await sessionManager.finishRun(activeRun.sessionId, activeRun.id, {
          status: 'failed',
          summary: errorMsg,
          toolCalls: steps.filter((step) => step.type === 'tool_call').length,
          observability: { traceRunId: trace?.runId, tracePath: traceResult?.outputPath, memory: context.memorySummary, context: context.budget },
        }).catch(() => undefined);
        if (finishedRun) await new ConversationStore(runConfig.session).addTurn({ sessionId: activeRun.sessionId, run: finishedRun, userInput: input, assistantText: errorMsg, toolCallCount: steps.filter((step) => step.type === 'tool_call').length }).catch(() => undefined);
      }
      return steps;
    }
  }

  private async runStreaming(input: { systemPrompt: string; messages: any[]; toolSet: ToolSet; maxSteps: number; responseStartedAt: number; estimatedPromptTokens: number; onStepFinish: (step: any) => void; emit: (event: import('./streaming/types.js').StreamingEventPayload) => Promise<void> }) {
    let completionText = '';
    let reasoningText = '';
    let reasoningStarted = false;
    const result = streamText({
      model: this.model,
      system: input.systemPrompt,
      messages: input.messages,
      tools: input.toolSet,
      stopWhen: stepCountIs(input.maxSteps),
      onStepFinish: input.onStepFinish,
      onFinish: async (event) => {
        if (event.reasoningText) await input.emit({ type: 'reasoning_end', text: event.reasoningText });
      },
      onChunk: async ({ chunk }) => {
        const elapsedMs = Date.now() - input.responseStartedAt;
        if (chunk.type === 'text-delta') {
          completionText += chunk.text;
          const completionTokens = estimateTokens(completionText);
          await input.emit({ type: 'token', text: chunk.text, completionTokens, elapsedMs });
          const cost = estimatedLiveCost(input.estimatedPromptTokens, completionTokens, this.config.llm.pricing);
          if (cost) await input.emit({ type: 'metrics', metrics: { promptTokens: input.estimatedPromptTokens, completionTokens, totalTokens: input.estimatedPromptTokens + completionTokens, source: 'estimated', responseDurationMs: elapsedMs, responseTokensPerSecond: completionTokens / Math.max(1, elapsedMs / 1000), cost } });
        } else if (chunk.type === 'reasoning-delta') {
          if (!reasoningStarted) {
            reasoningStarted = true;
            await input.emit({ type: 'reasoning_start', id: chunk.id });
          }
          reasoningText += chunk.text;
          await input.emit({ type: 'reasoning_delta', id: chunk.id, text: chunk.text, elapsedMs });
        } else if (chunk.type === 'tool-input-start') {
          await input.emit({ type: 'status', message: `tool input streaming: ${chunk.toolName}` });
        } else if (chunk.type === 'tool-call') {
          await input.emit({ type: 'tool_call', toolCallId: chunk.toolCallId, toolName: chunk.toolName, inputPreview: safePreview(chunk.input) });
        } else if (chunk.type === 'tool-result') {
          await input.emit({ type: 'tool_result', toolCallId: chunk.toolCallId, toolName: chunk.toolName, outputPreview: safePreview(chunk.output), ok: true });
        }
      },
    });
    return result;
  }

  /**
   * Build the system prompt from soul.md principles + tool descriptions
   */
  private buildSystemPrompt(): string {
    const outputContract = this.config.profile ? [
      '## Profile Trace Attribution',
      `- profile: ${this.config.profile.id}@${this.config.profile.version}`,
      `- source: ${this.config.profile.source}`,
      `- mode: ${this.config.profile.mode}`,
      '',
    ].join('\n') : '';
    const blocks: string[] = [
      this.config.systemPrompt,
      outputContract,
      '',
      '## Tool Access',
      '',
      '- Tool schemas are provided by the runtime; use only currently available tools when needed.',
      '- Dynamic Context Builder may include a compact capability summary when it is useful.',
      '- Do not assume unavailable skills, MCP servers, or tools exist unless present in runtime context.',
      '',
      '## Instructions',
      '- You reason step by step before calling tools.',
      '- You call only currently available tools when you need external context or actions.',
      '- After each tool call, observe the result and decide the next step.',
      '- When you have enough information, provide your final answer.',
      '- Be concise but thorough.',
      '',
      `Max reasoning steps: ${this.config.maxSteps ?? 15}`,
    ];

    return blocks.join('\n');
  }
}
