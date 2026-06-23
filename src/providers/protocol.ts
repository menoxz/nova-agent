import type { ProviderProtocol } from './types.js';

/**
 * Provider strings whose runtime adapter speaks the OpenAI Chat Completions
 * wire protocol (`/v1/chat/completions`, via `@ai-sdk/openai`'s `createOpenAI`).
 *
 * This set is the SINGLE SOURCE OF TRUTH for protocol selection. It MUST stay in
 * lockstep with `createModel` (src/llm/provider.ts): every provider listed here
 * routes through `createOpenAI`; every other provider — `anthropic`, `openmodel`,
 * and any unknown/default — routes through `createAnthropic` and therefore speaks
 * the Anthropic Messages protocol (`/v1/messages`).
 *
 * `createModel` and the doctor/profile resolution both derive from
 * `protocolForProvider` below so the advertised protocol can never drift from the
 * adapter that actually executes.
 */
export const OPENAI_COMPATIBLE_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'openrouter',
  'deepseek',
]);

/**
 * Resolve the wire protocol a provider string maps to.
 *
 * Mirrors `createModel`'s adapter branching exactly:
 *  - OpenAI-compatible providers → `openai-chat-completions` (createOpenAI)
 *  - everything else (anthropic, openmodel, unknown/default) → `anthropic-messages`
 *    (createAnthropic)
 */
export function protocolForProvider(provider: string): ProviderProtocol {
  const normalized = provider.trim().toLowerCase();
  return OPENAI_COMPATIBLE_PROVIDERS.has(normalized)
    ? 'openai-chat-completions'
    : 'anthropic-messages';
}
