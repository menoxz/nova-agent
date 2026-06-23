import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { AgentConfig } from '../types.js';
import { containsSecretLike } from '../memory/redaction.js';
import { assertPathUnderDir, projectNovaDir } from '../utils/safe_io.js';
import { validateTimezone } from '../heartbeat/schedule.js';

export const PROJECT_CONFIG_SCHEMA_VERSION = 1 as const;
export const PROJECT_CONFIG_FILENAME = 'config.json';

const budgetSchema = z.object({
  maxToolCalls: z.number().int().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxTotalTokens: z.number().int().positive().optional(),
  maxEstimatedCost: z.number().nonnegative().optional(),
  currency: z.string().min(1).optional(),
}).strict();

const heartbeatTaskSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/, 'Use 1-80 chars: letters, numbers, dot, underscore or dash.'),
  name: z.string().min(1).max(160).optional(),
  enabled: z.boolean().optional(),
  kind: z.string().min(1).max(80),
  action: z.string().min(1).max(80).optional(),
  schedule: z.object({
    type: z.enum(['manual', 'interval']),
    everyMinutes: z.number().int().positive().max(525_600).optional(),
    anchor: z.string().datetime().optional(),
  }).strict().optional(),
}).strict().superRefine((task, ctx) => {
  if (task.schedule?.type === 'interval' && task.schedule.everyMinutes === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'everyMinutes'], message: 'interval schedule requires everyMinutes' });
  }
  if (task.schedule?.type === 'manual' && task.schedule.everyMinutes !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'everyMinutes'], message: 'manual schedule must not set everyMinutes' });
  }
  if (task.schedule?.type === 'manual' && task.schedule.anchor !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'anchor'], message: 'manual schedule must not set anchor' });
  }
});

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(PROJECT_CONFIG_SCHEMA_VERSION).default(PROJECT_CONFIG_SCHEMA_VERSION),
  profile: z.string().min(1).optional(),
  maxSteps: z.number().int().positive().max(100).optional(),
  llm: z.object({
    providerProfile: z.string().min(1).optional(),
    fallbackProfiles: z.array(z.string().min(1)).optional(),
    provider: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().min(1).optional(),
    maxTokens: z.number().int().positive().optional(),
    robustness: z.object({
      timeoutMs: z.number().int().nonnegative().optional(),
      retries: z.number().int().nonnegative().max(5).optional(),
      retryBackoffMs: z.number().int().nonnegative().optional(),
      retryBackoffMultiplier: z.number().min(1).optional(),
    }).strict().optional(),
    pricing: z.object({
      currency: z.string().min(1).optional(),
      inputCostPer1MTokens: z.number().nonnegative().optional(),
      outputCostPer1MTokens: z.number().nonnegative().optional(),
      source: z.string().min(1).optional(),
    }).strict().optional(),
  }).strict().optional(),
  policy: z.object({
    enabled: z.boolean().optional(),
    profileId: z.string().min(1).optional(),
  }).strict().optional(),
  trace: z.object({
    enabled: z.boolean().optional(),
    outputDir: z.string().min(1).optional(),
    includeContent: z.boolean().optional(),
    contentMaxChars: z.number().int().positive().optional(),
    writeJsonlIndex: z.boolean().optional(),
    includeErrorStack: z.boolean().optional(),
  }).strict().optional(),
  context: z.object({
    enabled: z.boolean().optional(),
    tokenBudget: z.number().int().positive().optional(),
    userOrgTokenBudget: z.number().int().positive().optional(),
    memoryTokenBudget: z.number().int().positive().optional(),
    capabilityTokenBudget: z.number().int().positive().optional(),
    includeBudgetReport: z.boolean().optional(),
    includeUserOrgMemory: z.boolean().optional(),
    includeProjectMemory: z.boolean().optional(),
    includeCapabilities: z.boolean().optional(),
    includeConversationSummary: z.boolean().optional(),
    suggestionThreshold: z.number().min(0).max(1).optional(),
    maxSkillSuggestions: z.number().int().nonnegative().optional(),
    maxMcpSuggestions: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  streaming: z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(['compact', 'normal', 'verbose']).optional(),
    showTokens: z.boolean().optional(),
    showTools: z.boolean().optional(),
    showThinking: z.boolean().optional(),
    thinkingMode: z.enum(['hidden', 'collapsed', 'expanded']).optional(),
    showMetrics: z.boolean().optional(),
    showCost: z.boolean().optional(),
    refreshMs: z.number().int().positive().max(10_000).optional(),
    eventLog: z.object({
      enabled: z.boolean().optional(),
      root: z.string().min(1).optional(),
      includeText: z.boolean().optional(),
      maxTextChars: z.number().int().positive().max(20_000).optional(),
      maxEvents: z.number().int().positive().max(1_000_000).optional(),
    }).strict().optional(),
  }).strict().optional(),
  memory: z.object({
    enabled: z.boolean().optional(),
    memoryRoot: z.string().min(1).optional(),
    tokenBudget: z.number().int().positive().optional(),
    policyProfileId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    defaultScope: z.enum(['project', 'workspace', 'profile', 'session', 'user', 'subagent', 'capability']).optional(),
    readCollections: z.array(z.string().min(1)).optional(),
    writeCollections: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
  session: z.object({
    enabled: z.boolean().optional(),
    sessionsRoot: z.string().min(1).optional(),
    defaultSessionId: z.string().min(1).optional(),
    autoCreate: z.boolean().optional(),
    title: z.string().min(1).max(160).optional(),
    userId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    defaultBudget: budgetSchema.optional(),
    conversation: z.object({
      enabled: z.boolean().optional(),
      maxTurns: z.number().int().positive().optional(),
      keepRecentTurns: z.number().int().positive().optional(),
      maxPreviewChars: z.number().int().positive().optional(),
      summaryMaxChars: z.number().int().positive().optional(),
    }).strict().optional(),
  }).strict().optional(),
  heartbeat: z.object({
    enabled: z.boolean().optional(),
    tasks: z.array(heartbeatTaskSchema).max(100).optional(),
    timezone: z.string().min(1).refine(validateTimezone, 'invalid IANA timezone').optional(),
    quietHours: z.array(z.object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour format.'),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour format.'),
    }).strict()).max(24).optional(),
  }).strict().optional().superRefine((heartbeat, ctx) => {
    const seen = new Set<string>();
    for (const [index, task] of (heartbeat?.tasks ?? []).entries()) {
      if (seen.has(task.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tasks', index, 'id'], message: 'duplicate heartbeat task id' });
      seen.add(task.id);
    }
  }),
  runs: budgetSchema.optional(),
  toolConstraints: z.object({
    allowed: z.array(z.string().min(1)).optional(),
    denied: z.array(z.string().min(1)).optional(),
    presets: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export interface ProjectConfigLoadResult {
  path: string;
  present: boolean;
  ok: boolean;
  config?: ProjectConfig;
  errors: string[];
}

export function projectConfigPath(projectRoot = process.cwd()): string {
  const novaDir = projectNovaDir(projectRoot);
  return assertPathUnderDir(resolve(novaDir, PROJECT_CONFIG_FILENAME), novaDir, 'Project config path');
}

export function readProjectConfig(projectRoot = process.cwd()): ProjectConfigLoadResult {
  const path = projectConfigPath(projectRoot);
  if (!existsSync(path)) return { path, present: false, ok: true, errors: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const secretErrors = findForbiddenSecrets(parsed);
    const schemaResult = projectConfigSchema.safeParse(parsed);
    const errors = [
      ...secretErrors,
      ...(schemaResult.success ? [] : schemaResult.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)),
    ];
    return { path, present: true, ok: errors.length === 0, config: schemaResult.success && errors.length === 0 ? schemaResult.data : undefined, errors };
  } catch (err) {
    return { path, present: true, ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

export function requireProjectConfig(projectRoot = process.cwd()): ProjectConfig | undefined {
  const result = readProjectConfig(projectRoot);
  if (!result.ok) throw new Error(`Invalid Nova project config at ${result.path}: ${result.errors.join('; ')}`);
  return result.config;
}

export function defaultProjectConfig(): ProjectConfig {
  return {
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    profile: 'nova.builder',
    session: { enabled: true, autoCreate: true, title: 'Nova local work', tags: ['local'], conversation: { enabled: true } },
    policy: { profileId: 'developer' },
    context: { enabled: true, tokenBudget: 4000, includeConversationSummary: true },
    streaming: { enabled: true, mode: 'normal', showTokens: true, showTools: true, showThinking: true, thinkingMode: 'collapsed', showMetrics: true, showCost: true, eventLog: { enabled: false } },
    memory: { enabled: true },
    heartbeat: { enabled: false, tasks: [] },
    runs: { maxToolCalls: 20, maxTotalTokens: 120000, maxEstimatedCost: 1, currency: 'USD' },
  };
}

export function initProjectConfig(projectRoot = process.cwd(), force = false): ProjectConfigLoadResult {
  const path = projectConfigPath(projectRoot);
  if (existsSync(path) && !force) return { path, present: true, ok: false, errors: ['config already exists; refusing to overwrite without --force'] };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(defaultProjectConfig(), null, 2)}\n`, 'utf-8');
  return readProjectConfig(projectRoot);
}

export function mergeProjectConfig(base: AgentConfig, project?: ProjectConfig): AgentConfig {
  if (!project) return base;
  const defaultBudget = { ...(project.runs ?? {}), ...(project.session?.defaultBudget ?? {}) };
  return {
    ...base,
    maxSteps: project.maxSteps ?? base.maxSteps,
    llm: {
      ...base.llm,
      providerProfile: project.llm?.providerProfile ?? base.llm.providerProfile,
      fallbackProfiles: project.llm?.fallbackProfiles ?? base.llm.fallbackProfiles,
      provider: project.llm?.provider ?? base.llm.provider,
      baseUrl: project.llm?.baseUrl ?? base.llm.baseUrl,
      model: project.llm?.model ?? base.llm.model,
      maxTokens: project.llm?.maxTokens ?? base.llm.maxTokens,
      robustness: { ...base.llm.robustness, ...project.llm?.robustness },
      pricing: { currency: base.llm.pricing?.currency ?? project.llm?.pricing?.currency ?? 'USD', ...base.llm.pricing, ...project.llm?.pricing },
    },
    policy: { ...base.policy, ...project.policy },
    trace: { ...base.trace, ...project.trace },
    context: { ...base.context, ...project.context },
    streaming: { ...base.streaming, ...project.streaming },
    memory: { ...base.memory, ...project.memory },
    heartbeat: { ...base.heartbeat, ...project.heartbeat },
    session: {
      ...base.session,
      ...project.session,
      defaultBudget: { ...base.session?.defaultBudget, ...defaultBudget },
      conversation: { ...base.session?.conversation, ...project.session?.conversation },
    },
    toolConstraints: { ...base.toolConstraints, ...project.toolConstraints },
  };
}

export function explainProjectConfig(config?: ProjectConfig): string[] {
  if (!config) return ['No .nova/config.json found. Runtime uses env vars and built-in defaults only.'];
  const lines = ['Config File V1 loaded from .nova/config.json. Precedence: CLI/env values override project config; secrets/API keys must stay in env.'];
  if (config.profile) lines.push(`- profile: default agent profile is ${config.profile}.`);
  if (config.session) lines.push(`- session: enabled=${config.session.enabled ?? 'default'}, title=${config.session.title ?? 'default'}, conversation=${config.session.conversation?.enabled ?? 'default'}.`);
  if (config.policy) lines.push(`- policy: enabled=${config.policy.enabled ?? 'default'}, profileId=${config.policy.profileId ?? 'default'}.`);
  if (config.context) lines.push(`- context: enabled=${config.context.enabled ?? 'default'}, tokenBudget=${config.context.tokenBudget ?? 'default'}, conversationSummary=${config.context.includeConversationSummary ?? 'default'}.`);
  if (config.streaming) lines.push(`- streaming: enabled=${config.streaming.enabled ?? 'default'}, mode=${config.streaming.mode ?? 'default'}, tokens=${config.streaming.showTokens ?? 'default'}, tools=${config.streaming.showTools ?? 'default'}, thinking=${config.streaming.thinkingMode ?? (config.streaming.showThinking === false ? 'hidden' : 'default')}, eventLog=${config.streaming.eventLog?.enabled ?? 'default'}.`);
  if (config.memory) lines.push(`- memory: enabled=${config.memory.enabled ?? 'default'}, defaultScope=${config.memory.defaultScope ?? 'default'}.`);
  if (config.heartbeat) lines.push(`- heartbeat: enabled=${config.heartbeat.enabled ?? false}, tasks=${config.heartbeat.tasks?.length ?? 0}; V2 is dry-run planning only and starts no daemon.`);
  if (config.runs || config.session?.defaultBudget) lines.push('- runs: default run budgets are applied to session.defaultBudget unless env overrides them.');
  if (config.toolConstraints) lines.push('- toolConstraints: project defaults constrain available tools; policy still has final authority.');
  return lines;
}

export function sanitizeConfigForDisplay(config: AgentConfig): AgentConfig & { llm: AgentConfig['llm'] & { apiKey: string } } {
  return { ...config, llm: { ...config.llm, apiKey: config.llm.apiKey ? '[REDACTED:env]' : '' } };
}

// Make a ProjectConfigLoadResult safe to echo (e.g. `nova config show`): never leak the
// absolute config path and never print a secret-like value, while keeping plain identifiers
// (profile, session.projectId/userId/title) visible for usefulness.
export function sanitizeProjectLoadResultForDisplay(result: ProjectConfigLoadResult): ProjectConfigLoadResult {
  // Deep clone (so the caller's result is never mutated) while masking any secret-like string.
  const safe = redactSecretLikeDeep({ ...result });
  // Show only the project-relative tail of the config path, never the absolute filesystem path.
  if (typeof result.path === 'string') safe.path = redactProjectConfigPath(result.path);
  // Mirror the runtime echo: route any llm block through the shared sanitizer so a present
  // apiKey is masked with the same [REDACTED:env] token.
  if (safe.config) safe.config = sanitizeProjectConfigForDisplay(safe.config);
  return safe;
}

function sanitizeProjectConfigForDisplay(config: ProjectConfig): ProjectConfig {
  // A valid project config cannot carry an apiKey (rejected at load), but route an llm block
  // through the shared display sanitizer for defence-in-depth. Skip when llm is absent: there
  // is no apiKey to mask and sanitizeConfigForDisplay dereferences config.llm.apiKey directly.
  if (!config.llm) return config;
  return sanitizeConfigForDisplay(config as unknown as AgentConfig) as unknown as ProjectConfig;
}

function redactProjectConfigPath(path: string): string {
  // The config path is always <projectRoot>/.nova/config.json. Show only the project-relative
  // tail (matching the .nova/config.json convention used elsewhere in this module); fall back to
  // the basename when the path escapes the cwd, or to a masked token if anything looks unsafe.
  const rel = relative(process.cwd(), path);
  const tail = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : basename(path);
  const normalized = tail.split(/[\\/]+/).filter(Boolean).join('/');
  return normalized && !containsSecretLike(normalized) ? normalized : '[REDACTED:path]';
}

function redactSecretLikeDeep<T>(value: T): T {
  if (typeof value === 'string') return (containsSecretLike(value) ? '[REDACTED:secret-like]' : value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretLikeDeep(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) out[key] = redactSecretLikeDeep(child);
    return out as T;
  }
  return value;
}

function findForbiddenSecrets(value: unknown, path: string[] = []): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return containsSecretLike(value) ? [`${path.join('.') || '<root>'}: secret-like value is not allowed in .nova/config.json`] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenSecrets(item, [...path, String(index)]));
  if (typeof value !== 'object') return [];
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(api[_-]?key|secret|password|passwd|credential|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i.test(key)) {
      errors.push(`${[...path, key].join('.')}: secret key is not allowed in .nova/config.json`);
      continue;
    }
    errors.push(...findForbiddenSecrets(child, [...path, key]));
  }
  return errors;
}
