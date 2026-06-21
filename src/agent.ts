/**
 * Nova Agent — Core Agent Loop (ReAct)
 *
 * Implements the Reasoning + Acting loop:
 *   System Prompt → LLM → Tool Calls → Execute → Observe → LLM → ... → Answer
 *
 * Uses Vercel AI SDK v6+ for LLM interaction and tool handling.
 */

import { generateText, stepCountIs } from 'ai';
import type { ToolSet } from 'ai';
import chalk from 'chalk';

import type { AgentConfig, StepDisplay } from './types.js';
import { ToolRegistry } from './tools/registry.js';
import { ConversationMemory, userMessage, toolResultMessage } from './memory/conversation.js';
import { createModel } from './llm/provider.js';
import { createTraceRecorder } from './trace/recorder.js';

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
  async run(input: string): Promise<StepDisplay[]> {
    const steps: StepDisplay[] = [];
    const maxSteps = this.config.maxSteps ?? 15;

    // Build system prompt from soul + tools
    const systemPrompt = this.buildSystemPrompt();
    const trace = createTraceRecorder({
      input,
      model: this.config.llm.model,
      maxSteps,
      toolNames: this.tools.list().map((t) => t.name),
    }, this.config.trace);
    const toolSet = this.tools.toAITools({
      trace,
      policy: {
        enabled: this.config.policy?.enabled ?? true,
        profileId: this.config.policy?.profileId ?? 'readonly',
        actor: this.config.policy?.actor,
        delegation: this.config.policy?.delegation,
        approvalProvided: this.config.policy?.approvalProvided,
      },
    });

    // Add user message to memory
    this.memory.add(userMessage(input));
    const messages = this.memory.getMessages();

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        messages,
        tools: toolSet,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: (step) => {
          trace?.recordLlmStep({
            text: step.text,
            toolCallCount: step.toolCalls?.length ?? 0,
            toolResultCount: step.toolResults?.length ?? 0,
          });

          // Capture reasoning text ONLY if this step includes tool calls
          // (otherwise step.text IS the final answer = would cause duplicate display)
          if (step.text && step.toolCalls?.length) {
            steps.push({
              type: 'reasoning',
              content: step.text,
            });
          }

          // Capture tool calls
          if (step.toolCalls?.length) {
            for (const tc of step.toolCalls) {
              trace?.recordToolCall(tc.toolCallId, tc.toolName, tc.input);
              steps.push({
                type: 'tool_call',
                content: `Calling ${tc.toolName}(${JSON.stringify(tc.input)})`,
                toolName: tc.toolName,
                toolArgs: tc.input as Record<string, unknown>,
              });
            }
          }

          // Capture tool results
          if (step.toolResults?.length) {
            for (const tr of step.toolResults) {
              const outputStr = summarizeToolOutput(tr.output);
              trace?.recordToolResult(tr.toolCallId, tr.toolName, tr.output);
              steps.push({
                type: 'tool_result',
                content: outputStr,
                toolName: tr.toolName,
                toolResult: outputStr,
              });

              // Add tool result to memory
              this.memory.add(toolResultMessage(tr.toolCallId, tr.toolName, tr.output));
            }
          }
        },
      });

      // Add assistant's final response to memory
      const finalText = result.text || '(no response)';
      trace?.recordFinalAnswer(finalText);
      this.memory.add({
        role: 'assistant',
        content: [{ type: 'text', text: finalText }],
      });

      // Push final answer (no duplicate: reasoning only pushed when tools were used)
      steps.push({
        type: 'answer',
        content: finalText,
      });

      await trace?.finish('success');
      return steps;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      trace?.recordError(err);
      steps.push({
        type: 'answer',
        content: chalk.red(`\n✖ Error: ${errorMsg}`),
      });
      await trace?.finish('error');
      return steps;
    }
  }

  /**
   * Build the system prompt from soul.md principles + tool descriptions
   */
  private buildSystemPrompt(): string {
    const blocks: string[] = [
      this.config.systemPrompt,
      '',
      '## Available Tools',
      '',
      this.tools.list().map(t => {
        return `### ${t.name}\n${t.description}`;
      }).join('\n\n'),
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
