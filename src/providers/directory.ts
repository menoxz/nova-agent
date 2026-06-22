import { providerProfiles } from './profiles.js';
import type { ProviderDirectoryCategory, ProviderDirectoryEntry } from './types.js';

type EntryInput = Omit<ProviderDirectoryEntry, 'runtimeExecutable'> & { runtimeExecutable?: boolean };

function entry(input: EntryInput): ProviderDirectoryEntry {
  return {
    ...input,
    runtimeExecutable: input.runtimeExecutable ?? ['runtime-supported', 'openai-compatible', 'anthropic-compatible'].includes(input.category),
  };
}

const profileIdsByProvider = providerProfiles.reduce<Record<string, string[]>>((acc, profile) => {
  acc[profile.provider] = [...(acc[profile.provider] ?? []), profile.id];
  return acc;
}, {});

const entries: EntryInput[] = [
  // Popular / built-in runtime profiles
  { id: 'opencode-zen', name: 'OpenCode Zen (Recommended)', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'], notes: 'opencode subscription/gateway entry; metadata-only in Nova.' },
  { id: 'opencode-go', name: 'OpenCode Go', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'], notes: 'Low-cost opencode subscription; metadata-only in Nova.' },
  { id: 'openai', name: 'OpenAI (ChatGPT Plus/Pro or API key)', category: 'runtime-supported', profileIds: profileIdsByProvider.openai, compatibility: ['openai-chat-completions'] },
  { id: 'github-copilot', name: 'GitHub Copilot', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'], notes: 'Requires Copilot auth/provider integration; planned for Nova.' },
  { id: 'anthropic', name: 'Anthropic (API key)', category: 'runtime-supported', profileIds: profileIdsByProvider.anthropic, compatibility: ['anthropic-messages'] },
  { id: 'google', name: 'Google', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'], notes: 'opencode has a Google SDK route; Nova has no direct Google adapter yet.' },

  // Runtime-supported or compatible providers already represented by profiles
  { id: 'openrouter', name: 'OpenRouter', category: 'runtime-supported', profileIds: profileIdsByProvider.openrouter, compatibility: ['openai-chat-completions'] },
  { id: 'openmodel', name: 'OpenModel', category: 'runtime-supported', profileIds: profileIdsByProvider.openmodel, compatibility: ['anthropic-messages'] },
  { id: 'deepseek', name: 'DeepSeek', category: 'runtime-supported', profileIds: profileIdsByProvider.deepseek, compatibility: ['openai-chat-completions'] },
  { id: 'lmstudio', name: 'LMStudio', category: 'openai-compatible', compatibility: ['openai-chat-completions', 'local'], notes: 'Likely OpenAI-compatible local endpoint; requires explicit LLM_BASE_URL/model.' },
  { id: 'xai', name: 'xAI', category: 'openai-compatible', compatibility: ['openai-chat-completions'], notes: 'OpenAI-compatible style provider; no dedicated SDK bundled in Nova.' },
  { id: 'mistral', name: 'Mistral', category: 'openai-compatible', compatibility: ['openai-chat-completions'], notes: 'Direct adapter planned; OpenRouter profile exists for Mistral large.' },
  { id: 'groq', name: 'Groq', category: 'openai-compatible', compatibility: ['openai-chat-completions'], notes: 'Direct adapter planned; OpenRouter profile exists for Groq Llama.' },
  { id: 'perplexity', name: 'Perplexity', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },
  { id: 'together-ai', name: 'Together AI', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },
  { id: 'deep-infra', name: 'Deep Infra', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },
  { id: 'fireworks-ai', name: 'Fireworks AI', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },
  { id: 'cerebras', name: 'Cerebras', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },
  { id: 'cohere', name: 'Cohere', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'ollama-cloud', name: 'Ollama Cloud', category: 'openai-compatible', compatibility: ['openai-chat-completions'] },

  // Gateways / subscription / token-plan entries
  { id: 'requesty', name: 'Requesty', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'llm-gateway', name: 'LLM Gateway', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'merge-gateway', name: 'Merge Gateway', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'kilo-gateway', name: 'Kilo Gateway', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'zenmux', name: 'ZenMux', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'freemodel', name: 'FreeModel', category: 'gateway-subscription-token-plan', runtimeExecutable: false, compatibility: ['gateway'] },
  { id: 'minimax-token-plan-minimax-io', name: 'MiniMax Token Plan (minimax.io)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'minimax-token-plan-minimaxi-com', name: 'MiniMax Token Plan (minimaxi.com)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'alibaba-token-plan-china', name: 'Alibaba Token Plan (China)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'alibaba-token-plan', name: 'Alibaba Token Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'alibaba-coding-plan-china', name: 'Alibaba Coding Plan (China)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'alibaba-coding-plan', name: 'Alibaba Coding Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'xiaomi-token-plan-europe', name: 'Xiaomi Token Plan (Europe)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'xiaomi-token-plan-china', name: 'Xiaomi Token Plan (China)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'xiaomi-token-plan-singapore', name: 'Xiaomi Token Plan (Singapore)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'tencent-coding-plan-china', name: 'Tencent Coding Plan (China)', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'tencent-tokenhub', name: 'Tencent TokenHub', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'z-ai-coding-plan', name: 'Z.AI Coding Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'zhipu-ai-coding-plan', name: 'Zhipu AI Coding Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'kimi-for-coding', name: 'Kimi For Coding', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'umans-ai-coding-plan', name: 'Umans AI Coding Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },
  { id: 'kuae-cloud-coding-plan', name: 'KUAE Cloud Coding Plan', category: 'gateway-subscription-token-plan', runtimeExecutable: false },

  // SDK/provider integrations present in opencode but planned in Nova
  { id: 'qiniu', name: 'Qiniu', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'alibaba-china', name: 'Alibaba (China)', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'alibaba', name: 'Alibaba', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'regolo-ai', name: 'Regolo AI', category: 'planned', runtimeExecutable: false },
  { id: 'stackit', name: 'STACKIT', category: 'planned', runtimeExecutable: false },
  { id: 'hugging-face', name: 'Hugging Face', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'novitaai', name: 'NovitaAI', category: 'planned', runtimeExecutable: false },
  { id: 'privatemode-ai', name: 'Privatemode AI', category: 'planned', runtimeExecutable: false },
  { id: 'd-run-china', name: 'D.Run (China)', category: 'planned', runtimeExecutable: false },
  { id: 'moonshot-ai', name: 'Moonshot AI', category: 'planned', runtimeExecutable: false },
  { id: 'moonshot-ai-china', name: 'Moonshot AI (China)', category: 'planned', runtimeExecutable: false },
  { id: 'vultr', name: 'Vultr', category: 'planned', runtimeExecutable: false },
  { id: '302-ai', name: '302.AI', category: 'planned', runtimeExecutable: false },
  { id: 'zhipu-ai', name: 'Zhipu AI', category: 'planned', runtimeExecutable: false },
  { id: 'cortecs', name: 'Cortecs', category: 'planned', runtimeExecutable: false },
  { id: 'nebius-token-factory', name: 'Nebius Token Factory', category: 'planned', runtimeExecutable: false },
  { id: 'auriko', name: 'Auriko', category: 'planned', runtimeExecutable: false },
  { id: 'stepfun-ai', name: 'StepFun AI', category: 'planned', runtimeExecutable: false },
  { id: 'stepfun', name: 'StepFun', category: 'planned', runtimeExecutable: false },
  { id: 'vivgrid', name: 'Vivgrid', category: 'planned', runtimeExecutable: false },
  { id: 'cloudflare-workers-ai', name: 'Cloudflare Workers AI', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'bailing', name: 'Bailing', category: 'planned', runtimeExecutable: false },
  { id: 'anyapi', name: 'AnyAPI', category: 'planned', runtimeExecutable: false },
  { id: 'digitalocean', name: 'DigitalOcean', category: 'planned', runtimeExecutable: false },
  { id: 'venice-ai', name: 'Venice AI', category: 'planned', runtimeExecutable: false },
  { id: 'poolside', name: 'Poolside', category: 'planned', runtimeExecutable: false },
  { id: 'berget-ai', name: 'Berget.AI', category: 'planned', runtimeExecutable: false },
  { id: 'snowflake-cortex', name: 'Snowflake Cortex', category: 'planned', runtimeExecutable: false },
  { id: 'github-models', name: 'GitHub Models', category: 'planned', runtimeExecutable: false },
  { id: 'neuralwatt', name: 'Neuralwatt', category: 'planned', runtimeExecutable: false },
  { id: 'siliconflow-china', name: 'SiliconFlow (China)', category: 'planned', runtimeExecutable: false },
  { id: 'siliconflow', name: 'SiliconFlow', category: 'planned', runtimeExecutable: false },
  { id: 'qihang', name: 'QiHang', category: 'planned', runtimeExecutable: false },
  { id: 'modelscope', name: 'ModelScope', category: 'planned', runtimeExecutable: false },
  { id: 'mixlayer', name: 'Mixlayer', category: 'planned', runtimeExecutable: false },
  { id: 'orcarouter', name: 'OrcaRouter', category: 'planned', runtimeExecutable: false },
  { id: 'helicone', name: 'Helicone', category: 'planned', runtimeExecutable: false },
  { id: 'z-ai', name: 'Z.AI', category: 'planned', runtimeExecutable: false },
  { id: 'near-ai-cloud', name: 'NEAR AI Cloud', category: 'planned', runtimeExecutable: false },
  { id: 'abacus', name: 'Abacus', category: 'planned', runtimeExecutable: false },
  { id: 'cloudferro-sherlock', name: 'CloudFerro Sherlock', category: 'planned', runtimeExecutable: false },
  { id: 'morph', name: 'Morph', category: 'planned', runtimeExecutable: false },
  { id: 'vertex-anthropic', name: 'Vertex (Anthropic)', category: 'planned', runtimeExecutable: false, compatibility: ['anthropic-messages', 'sdk-required'] },
  { id: 'v0', name: 'v0', category: 'planned', runtimeExecutable: false },
  { id: 'azure', name: 'Azure', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'nvidia', name: 'Nvidia', category: 'planned', runtimeExecutable: false },
  { id: 'evroc', name: 'evroc', category: 'planned', runtimeExecutable: false },
  { id: 'xiaomi', name: 'Xiaomi', category: 'planned', runtimeExecutable: false },
  { id: 'inception', name: 'Inception', category: 'planned', runtimeExecutable: false },
  { id: 'inference', name: 'Inference', category: 'planned', runtimeExecutable: false },
  { id: 'inceptron', name: 'Inceptron', category: 'planned', runtimeExecutable: false },
  { id: 'llama', name: 'Llama', category: 'planned', runtimeExecutable: false },
  { id: 'llmtr', name: 'LLMTR', category: 'planned', runtimeExecutable: false },
  { id: 'sarvam-ai', name: 'Sarvam AI', category: 'planned', runtimeExecutable: false },
  { id: 'hpc-ai', name: 'HPC-AI', category: 'planned', runtimeExecutable: false },
  { id: 'minimax-minimaxi-com', name: 'MiniMax (minimaxi.com)', category: 'planned', runtimeExecutable: false },
  { id: 'minimax-minimax-io', name: 'MiniMax (minimax.io)', category: 'planned', runtimeExecutable: false },
  { id: 'poe', name: 'Poe', category: 'planned', runtimeExecutable: false },
  { id: 'dinference', name: 'DInference', category: 'planned', runtimeExecutable: false },
  { id: 'perplexity-agent', name: 'Perplexity Agent', category: 'planned', runtimeExecutable: false },
  { id: 'io-net', name: 'IO.NET', category: 'planned', runtimeExecutable: false },
  { id: 'gmi-cloud', name: 'GMI Cloud', category: 'planned', runtimeExecutable: false },
  { id: 'zeldoc', name: 'Zeldoc', category: 'planned', runtimeExecutable: false },
  { id: 'scaleway', name: 'Scaleway', category: 'planned', runtimeExecutable: false },
  { id: 'ovhcloud-ai-endpoints', name: 'OVHcloud AI Endpoints', category: 'planned', runtimeExecutable: false },
  { id: 'friendli', name: 'Friendli', category: 'planned', runtimeExecutable: false },
  { id: 'weights-and-biases', name: 'Weights & Biases', category: 'planned', runtimeExecutable: false },
  { id: 'gitlab-duo', name: 'GitLab Duo', category: 'planned', runtimeExecutable: false },
  { id: 'lucidquery', name: 'LucidQuery', category: 'planned', runtimeExecutable: false },
  { id: 'meganova', name: 'Meganova', category: 'planned', runtimeExecutable: false },
  { id: 'amazon-bedrock', name: 'Amazon Bedrock', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'umans-ai', name: 'Umans AI', category: 'planned', runtimeExecutable: false },
  { id: 'frogbot', name: 'FrogBot', category: 'planned', runtimeExecutable: false },
  { id: 'jiekou-ai', name: 'Jiekou.AI', category: 'planned', runtimeExecutable: false },
  { id: 'nova', name: 'Nova', category: 'planned', runtimeExecutable: false },
  { id: 'databricks', name: 'Databricks', category: 'planned', runtimeExecutable: false },
  { id: 'crofai', name: 'CrofAI', category: 'planned', runtimeExecutable: false },
  { id: 'fastrouter', name: 'FastRouter', category: 'planned', runtimeExecutable: false },
  { id: 'abliteration-ai', name: 'abliteration.ai', category: 'planned', runtimeExecutable: false },
  { id: 'xpersona', name: 'Xpersona', category: 'planned', runtimeExecutable: false },
  { id: 'azure-cognitive-services', name: 'Azure Cognitive Services', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'baseten', name: 'Baseten', category: 'planned', runtimeExecutable: false },
  { id: 'atomic-chat', name: 'Atomic Chat', category: 'planned', runtimeExecutable: false },
  { id: 'routing-run', name: 'routing.run', category: 'planned', runtimeExecutable: false },
  { id: 'aihubmix', name: 'AIHubMix', category: 'planned', runtimeExecutable: false },
  { id: 'vertex', name: 'Vertex', category: 'planned', runtimeExecutable: false, compatibility: ['sdk-required'] },
  { id: 'nanogpt', name: 'NanoGPT', category: 'planned', runtimeExecutable: false },
  { id: 'moark', name: 'Moark', category: 'planned', runtimeExecutable: false },
  { id: 'lilac', name: 'Lilac', category: 'planned', runtimeExecutable: false },
  { id: 'ambient', name: 'Ambient', category: 'planned', runtimeExecutable: false },
  { id: 'neon', name: 'Neon', category: 'planned', runtimeExecutable: false },
  { id: 'upstage', name: 'Upstage', category: 'planned', runtimeExecutable: false },
  { id: 'chutes', name: 'Chutes', category: 'planned', runtimeExecutable: false },
  { id: 'wafer', name: 'Wafer', category: 'planned', runtimeExecutable: false },
  { id: 'clarifai', name: 'Clarifai', category: 'planned', runtimeExecutable: false },
  { id: 'the-grid-ai', name: 'The Grid AI', category: 'planned', runtimeExecutable: false },
  { id: 'synthetic', name: 'Synthetic', category: 'planned', runtimeExecutable: false },
  { id: 'iflow', name: 'iFlow', category: 'planned', runtimeExecutable: false },
  { id: 'claudinio', name: 'Claudinio', category: 'planned', runtimeExecutable: false },

  // User/custom extension point
  { id: 'submodel', name: 'submodel', category: 'custom-other', runtimeExecutable: false, compatibility: ['custom'] },
  { id: 'other-custom-provider', name: 'Other Custom provider', category: 'custom-other', runtimeExecutable: false, compatibility: ['custom'], notes: 'Use explicit LLM_PROVIDER/LLM_BASE_URL/LLM_MODEL for custom OpenAI/Anthropic-compatible endpoints.' },
];

export const providerDirectory: ProviderDirectoryEntry[] = entries.map(entry);

export function listProviderDirectory(): ProviderDirectoryEntry[] {
  return [...providerDirectory];
}

export function getProviderDirectoryEntry(idOrName: string | undefined): ProviderDirectoryEntry | undefined {
  if (!idOrName) return undefined;
  const normalized = idOrName.toLowerCase();
  return providerDirectory.find((provider) => provider.id === normalized || provider.name.toLowerCase() === normalized);
}

export function providerDirectorySummary(): Record<ProviderDirectoryCategory, number> {
  return providerDirectory.reduce<Record<ProviderDirectoryCategory, number>>((acc, provider) => {
    acc[provider.category] += 1;
    return acc;
  }, {
    'runtime-supported': 0,
    'openai-compatible': 0,
    'anthropic-compatible': 0,
    planned: 0,
    'gateway-subscription-token-plan': 0,
    'custom-other': 0,
  });
}
