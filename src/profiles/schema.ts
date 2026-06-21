import { z } from 'zod';
import { PROFILE_SCHEMA_VERSION } from './types.js';

const idSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'profile id must be lowercase dotted/kebab identifier');
const capabilitySchema = z.enum(['read', 'write', 'shell', 'network', 'git', 'mcp', 'lsp', 'memory', 'eval', 'trace']);

export const agentProfileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  identity: z.object({
    id: idSchema,
    version: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    objective: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
  }),
  model: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    fallback: z.array(z.object({ provider: z.string().min(1), modelId: z.string().min(1) })).optional(),
    overrideRules: z.object({
      allowEnvironmentOverride: z.boolean(),
      allowRuntimeOverride: z.boolean(),
      lockedFields: z.array(z.enum(['provider', 'modelId', 'temperature', 'maxTokens'])).optional(),
    }),
  }),
  prompts: z.object({
    system: z.string().min(1),
    developer: z.string().optional(),
    constraints: z.array(z.string().min(1)).default([]),
    style: z.array(z.string().min(1)).default([]),
  }),
  runtime: z.object({
    maxSteps: z.number().int().positive().max(100),
    stopConditions: z.array(z.string().min(1)).default([]),
    defaultMode: z.enum(['root', 'subagent', 'tool_worker']),
  }),
  tools: z.object({
    allowed: z.array(z.string().min(1)).default([]),
    denied: z.array(z.string().min(1)).default([]),
    presets: z.array(z.string().min(1)).default([]),
  }),
  policy: z.object({
    profileId: z.string().min(1),
    capabilities: z.array(capabilitySchema),
    approvalRequiredFor: z.array(z.string().min(1)).default([]),
  }),
  memory: z.object({
    scope: z.enum(['none', 'session', 'project', 'workspace', 'future']),
    readCollections: z.array(z.string().min(1)).default([]),
    writeCollections: z.array(z.string().min(1)).default([]),
    retention: z.object({
      ttlDays: z.number().int().positive().optional(),
      maxItems: z.number().int().positive().optional(),
      strategy: z.enum(['none', 'session', 'summarize', 'archive', 'future']),
    }),
  }),
  eval: z.object({
    suiteIds: z.array(z.string().min(1)).default([]),
    requiredGates: z.array(z.string().min(1)).default([]),
    baselineHooks: z.array(z.string().min(1)).default([]),
  }),
  output: z.object({
    format: z.enum(['text', 'markdown', 'json', 'structured']),
    schema: z.record(z.unknown()).optional(),
    requiredSections: z.array(z.string().min(1)).default([]),
  }),
  subagent: z.object({
    compatibleRoles: z.array(z.string().min(1)).default([]),
    canRunAsRoot: z.boolean(),
    canRunAsSubagent: z.boolean(),
    canRunAsToolWorker: z.boolean(),
    verificationIndependence: z.boolean(),
  }),
  trace: z.object({
    profileId: z.string().optional(),
    profileVersion: z.string().optional(),
    profileHash: z.string().optional(),
    source: z.enum(['builtin', 'custom', 'imported']).optional(),
    mode: z.enum(['root', 'subagent', 'tool_worker']).optional(),
  }).optional(),
});

export type AgentProfileSchemaInput = z.infer<typeof agentProfileSchema>;
