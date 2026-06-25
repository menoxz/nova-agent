import { compactTextToTokenBudget, estimateTokenCost, estimateTokenUsage } from './index.js';
import type { LlmPricingConfig } from './types.js';

export async function handleTokensCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'tokens') return false;
  if (action === 'estimate') {
    const text = positionalText(rest);
    if (!text) return missingTokenArgument('nova tokens estimate <text>');
    const usage = estimateTokenUsage({ promptText: text });
    const cost = estimateTokenCost({ promptTokens: usage.promptTokens, completionTokens: 0, source: usage.source, pricing: pricingFromEnv(process.env) });
    console.log(JSON.stringify({ usage, cost, pricingConfigured: Boolean(cost) }, null, 2));
    return true;
  }
  if (action === 'compact') {
    const text = positionalText(rest);
    if (!text) return missingTokenArgument('nova tokens compact <text> --budget <tokens>');
    const budget = numberOption(rest, 'budget', 200);
    if (budget < 10) throw new Error('--budget must be at least 10 tokens');
    console.log(JSON.stringify(compactTextToTokenBudget(text, budget, { reason: option(rest, 'reason') ?? 'cli' }), null, 2));
    return true;
  }
  if (action === 'doctor' || action === undefined) {
    const sample = 'Nova token diagnostics sample with deterministic local estimation.';
    const usage = estimateTokenUsage({ promptText: sample, completionText: 'ok' });
    const pricing = pricingFromEnv(process.env);
    const cost = estimateTokenCost({ promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, source: usage.source, pricing });
    const compaction = compactTextToTokenBudget(Array.from({ length: 20 }, (_, index) => `line ${index} diagnostic context`).join('\n'), 40, { reason: 'doctor' });
    console.log(JSON.stringify({
      ok: true,
      estimator: 'chars_per_4_ceiling',
      usage,
      pricing: { configured: Boolean(cost), currency: pricing?.currency ?? 'USD', source: pricing?.source ?? 'unset' },
      cost,
      compaction: { compacted: compaction.compacted, originalTokens: compaction.originalTokens, compactedTokens: compaction.compactedTokens, omittedLines: compaction.omittedLines },
      safety: { invokesLlm: false, invokesTools: false, readsSecrets: false, writesFiles: false },
    }, null, 2));
    return true;
  }
  console.error('Unknown Nova tokens command. Usage: nova tokens estimate <text> | nova tokens compact <text> --budget <tokens> | nova tokens doctor');
  process.exitCode = 1;
  return true;
}

export function pricingFromEnv(env: NodeJS.ProcessEnv): LlmPricingConfig | undefined {
  const input = numberEnv(env.LLM_INPUT_COST_PER_1M_TOKENS);
  const output = numberEnv(env.LLM_OUTPUT_COST_PER_1M_TOKENS);
  if (input === undefined && output === undefined) return undefined;
  return { currency: (env.LLM_PRICING_CURRENCY || 'USD').toUpperCase(), inputCostPer1MTokens: input, outputCostPer1MTokens: output, source: env.LLM_PRICING_SOURCE || 'env' };
}

function positionalText(args: string[]): string {
  return args.filter((value) => !value.startsWith('--') && !previousIsOption(args, value)).join(' ').trim();
}

function option(args: string[], name: string): string | undefined {
  const direct = args.indexOf(`--${name}`);
  if (direct >= 0) return args[direct + 1];
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(args: string[], name: string, fallback: number): number {
  const parsed = Number(option(args, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function previousIsOption(args: string[], value: string): boolean {
  const index = args.indexOf(value);
  return index > 0 && args[index - 1]?.startsWith('--') && !args[index - 1]?.includes('=');
}

function missingTokenArgument(usage: string): true {
  console.error(`Missing argument. Usage: ${usage}`);
  process.exitCode = 1;
  return true;
}
