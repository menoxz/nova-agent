#!/usr/bin/env node
/**
 * Nova Agent — Gated live LLM smoke (§4: one authorized real call)
 *
 * Purpose
 * -------
 * Empirically prove that the configured `openmodel` provider reaches a live
 * Anthropic-compatible endpoint and returns a known sentinel token — using the
 * exact same `createModel()` adapter selection the agent uses in production.
 *
 * Safety contract
 * ---------------
 * - OFF by default. Refuses (exit 0) unless BOTH:
 *     NOVA_ENABLE_LIVE_LLM=1|true  AND  LLM_API_KEY is present.
 *   This mirrors the NOVA_ENABLE_WRITE_TOOLS opt-in and keeps the script out of
 *   `npm run check` semantics (it is intentionally NOT wired into `check`).
 * - Exactly ONE request: a single generateText() call, tools DISABLED (no
 *   `tools` key, no `stopWhen`), temperature 0, <=64 output tokens, no retries.
 * - Never prints secrets: no API key, no credential-bearing URL, and no raw
 *   provider error bodies. Only sanitized facts are emitted — which adapter ran,
 *   the HTTP status class, whether NOVA_LIVE_OK returned, and token usage.
 * - Aborts (exit 1, no extra retries) on auth / 404 / rate-limit / network /
 *   tool-call / unknown errors via the shared classifyLlmError() taxonomy.
 */
import { generateText } from 'ai';

import { createModel, isLiveLlmEnabled } from './provider.js';
import { classifyLlmError } from './robustness.js';
import type { LLMConfig } from '../types.js';

// ── Authorized live-call parameters (hardcoded, non-secret constants) ─────────
const PROVIDER = 'openmodel';
const BASE_URL = 'https://api.openmodel.ai/v1';
const MODEL = 'deepseek-v4-flash';
const ADAPTER = 'anthropic-messages (openmodel -> createAnthropic)';
const SENTINEL = 'NOVA_LIVE_OK';
const PROMPT = `Respond with exactly this token and nothing else: ${SENTINEL}`;
const MAX_OUTPUT_TOKENS = 64;

/** Refuse cleanly (exit 0) — the gate is an opt-in, not a failure. */
function refuse(reason: string): never {
  console.log(`llm:live-smoke skipped — ${reason}`);
  process.exit(0);
}

/** Collapse an HTTP status code to its class (e.g. 401 -> "4xx"); never leaks a body. */
function statusClass(code?: number): string {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'unknown';
  return `${Math.floor(code / 100)}xx`;
}

/** Render a token count or a safe placeholder (usage fields may be undefined). */
function tok(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'n/a';
}

async function main(): Promise<void> {
  // ── Gate 1: explicit opt-in flag (mirrors isLiveLlmEnabled / write-tools) ───
  if (!isLiveLlmEnabled()) {
    refuse('NOVA_ENABLE_LIVE_LLM is not set to 1|true (live calls are opt-in only)');
  }
  // ── Gate 2: credential presence (existence check only — value never read out) ─
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    refuse('LLM_API_KEY is not present in the environment');
  }

  const config: LLMConfig = {
    provider: PROVIDER,
    baseUrl: BASE_URL,
    apiKey,
    model: MODEL,
  };

  console.log('llm:live-smoke — single authorized live call');
  console.log(`  provider=${PROVIDER} model=${MODEL}`);
  console.log(`  endpoint=${BASE_URL} adapter=${ADAPTER}`);
  console.log(`  budget: 1 request, <=${MAX_OUTPUT_TOKENS} output tokens, temperature 0, tools DISABLED, retries 0`);

  // Build the model via the SAME adapter switch production uses. A 2xx here is
  // empirical proof the anthropic-messages adapter matched the endpoint (a
  // mismatched adapter would surface as 404 / endpoint_incompatible).
  const model = createModel(config);

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      prompt: PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      maxRetries: 0,
      // tools intentionally omitted → tool use disabled; no stopWhen → one round-trip.
    });
  } catch (err) {
    const classified = classifyLlmError(err);
    console.error('  result: FAILED — no NOVA_LIVE_OK');
    console.error(`  adapter-ran=${ADAPTER}`);
    console.error(`  http-status-class=${statusClass(classified.statusCode)} kind=${classified.kind}`);
    console.error(`  diagnostic=${classified.diagnostic}`);
    process.exit(1);
  }

  // ── Tool-call guard: abort if the model tried to call a tool despite none ───
  if (result.finishReason === 'tool-calls' || (result.toolCalls?.length ?? 0) > 0) {
    console.error('  result: ABORTED — model attempted a tool call while tools were disabled');
    console.error(`  adapter-ran=${ADAPTER} finishReason=${result.finishReason}`);
    process.exit(1);
  }

  // Success path reached → transport returned HTTP 2xx.
  const ok = (result.text ?? '').includes(SENTINEL);
  const usage = result.usage;

  console.log('  result: SUCCESS — transport HTTP 2xx');
  console.log(`  adapter-ran=${ADAPTER}`);
  console.log('  http-status-class=2xx');
  console.log(`  NOVA_LIVE_OK-returned=${ok}`);
  console.log(`  usage: input=${tok(usage?.inputTokens)} output=${tok(usage?.outputTokens)} total=${tok(usage?.totalTokens)}`);
  console.log(`  finishReason=${result.finishReason}`);

  if (!ok) {
    console.error('  assertion FAILED: response did not contain the NOVA_LIVE_OK sentinel');
    process.exit(1);
  }

  console.log('llm:live-smoke passed');
}

main().catch((err) => {
  // Last-resort guard: classify + sanitize; never dump a raw error/body.
  const classified = classifyLlmError(err);
  console.error(`llm:live-smoke failed: kind=${classified.kind} http-status-class=${statusClass(classified.statusCode)} ${classified.diagnostic}`);
  process.exit(1);
});
