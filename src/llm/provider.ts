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
import { protocolForProvider } from '../providers/protocol.js';

/**
 * Resolve an LLM model from the Nova config.
 *
 * Adapter selection derives from the SAME provider→protocol mapping that
 * `providers doctor` advertises (see src/providers/protocol.ts), so the
 * advertised protocol and the executed adapter can never diverge:
 *  - `openai-chat-completions` → `createOpenAI` (/v1/chat/completions)
 *  - `anthropic-messages`      → `createAnthropic` (/v1/messages)
 */
export function createModel(config: LLMConfig): LanguageModel {
  const provider = config.provider?.toLowerCase() || 'openmodel';

  switch (protocolForProvider(provider)) {
    case 'openai-chat-completions': {
      // OpenAI-compatible API (openai, openrouter, deepseek)
      const openai = createOpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return openai.chat(config.model);
    }

    case 'anthropic-messages':
    default: {
      // Anthropic-compatible API (anthropic, openmodel, and the default for
      // unknown providers — e.g., OpenModel, Anthropic direct).
      const anthropic = createAnthropic({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return anthropic.chat(config.model);
    }
  }
}

/**
 * Live LLM opt-in gate.
 *
 * Mirrors the NOVA_ENABLE_WRITE_TOOLS pattern: real network calls to a live
 * provider are OFF by default and only enabled when NOVA_ENABLE_LIVE_LLM is
 * explicitly set to "1" or "true". This keeps `npm run check` fully offline.
 */
export function isLiveLlmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.NOVA_ENABLE_LIVE_LLM;
  return flag === '1' || flag === 'true';
}
