/**
 * Nova Agent — LLM Provider
 *
 * Creates a configured LLM model from the Vercel AI SDK
 * based on environment configuration.
 *
 * Supports multiple provider types:
 * - "anthropic" / "openmodel": Anthropic-compatible API (/v1/messages)
 * - "openai" / "openrouter": OpenAI-compatible API (/v1/chat/completions)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { LLMConfig } from '../types.js';

/**
 * Resolve an LLM model from the Nova config.
 */
export function createModel(config: LLMConfig): LanguageModel {
  const provider = config.provider?.toLowerCase() || 'openmodel';

  switch (provider) {
    case 'anthropic':
    case 'openmodel': {
      // Anthropic-compatible API (e.g., OpenModel, Anthropic direct)
      const anthropic = createAnthropic({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return anthropic.chat(config.model);
    }

    case 'openai':
    case 'openrouter':
    case 'deepseek': {
      // OpenAI-compatible API
      const openai = createOpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return openai.chat(config.model);
    }

    default: {
      // Try Anthropic by default (covers OpenModel)
      const anthropic = createAnthropic({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return anthropic.chat(config.model);
    }
  }
}
