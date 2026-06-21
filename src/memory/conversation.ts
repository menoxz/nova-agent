/**
 * Nova Agent — Conversation Memory
 *
 * Stores the conversation history as an array of ModelMessage objects
 * compatible with the Vercel AI SDK v6+.
 *
 * Currently in-memory (future: file-backed, RAG, summarization).
 */

import type { ModelMessage, ToolResultOutput } from '@ai-sdk/provider-utils';

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Helper to create a user message from text.
 */
export function userMessage(text: string): ModelMessage {
  return {
    role: 'user',
    content: [{ type: 'text' as const, text }],
  };
}

/**
 * Helper to create an assistant message from text.
 */
export function assistantMessage(text: string): ModelMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text' as const, text }],
  };
}

/**
 * Helper to create a tool result message.
 */
export function toolResultMessage(toolCallId: string, toolName: string, result: unknown): ModelMessage {
  return {
    role: 'tool' as const,
    content: [{
      type: 'tool-result' as const,
      toolCallId,
      toolName,
      output: isToolResultOutput(result)
        ? result
        : typeof result === 'string'
        ? { type: 'text' as const, value: result.slice(0, 10000) }
        : { type: 'json' as const, value: result as any },
    }],
  };
}

export class ConversationMemory {
  private messages: ModelMessage[] = [];
  private maxMessages: number;

  constructor(maxMessages = 50) {
    this.maxMessages = maxMessages;
  }

  add(msg: ModelMessage): void {
    this.messages.push(msg);
    // Trim oldest messages if we exceed the limit
    if (this.messages.length > this.maxMessages) {
      const systemMsgs = this.messages.filter(m => m.role === 'system');
      const nonSystemMsgs = this.messages.filter(m => m.role !== 'system');
      const sliced = nonSystemMsgs.slice(-(this.maxMessages - systemMsgs.length));
      this.messages = [...systemMsgs, ...sliced];
    }
  }

  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  get length(): number {
    return this.messages.length;
  }
}
