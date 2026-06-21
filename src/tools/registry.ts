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
  toAITools(options: { trace?: ToolTraceSink } = {}): ToolSet {
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
            const output = await def.execute(input, { toolCallId });
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
