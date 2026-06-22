#!/usr/bin/env node

/**
 * Nova Agent — Entrypoint
 *
 * Usage:
 *   npx tsx src/index.ts              → interactive mode
 *   npx tsx src/index.ts "prompt"     → single prompt mode
 */

import chalk from 'chalk';
import { intro, outro, spinner, text, isCancel, cancel } from '@clack/prompts';

import { NovaAgent } from './agent.js';
import { ToolRegistry } from './tools/registry.js';
import { readFileTool } from './tools/builtin/read_file.js';
import { writeFileTool } from './tools/builtin/write_file.js';
import { bashTool } from './tools/builtin/bash.js';
import { globTool } from './tools/builtin/glob.js';
import { grepTool } from './tools/builtin/grep.js';
import { listDirectoryTool } from './tools/builtin/list_directory.js';
import { getFileInfoTool } from './tools/builtin/get_file_info.js';
import { readPdfTool } from './tools/builtin/read_pdf.js';
import { readDocxTool } from './tools/builtin/read_docx.js';
import { readExcelTool } from './tools/builtin/read_excel.js';
import { webSearchTool } from './tools/builtin/web_search.js';
import { gitTool } from './tools/builtin/git.js';
import { todoTool } from './tools/builtin/todo.js';
import { goalTool } from './tools/builtin/goal.js';
import { skillTool } from './tools/builtin/skill.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LLMConfig, AgentConfig, StepDisplay } from './types.js';
import { resolveConfigProfile } from './profiles/index.js';
import { ApprovalManager } from './approval/index.js';
import { ConversationStore, CurrentSessionStore, RunReplayManager, RunResumeManager, SessionStore } from './session/index.js';
import { explainProjectConfig, initProjectConfig, readProjectConfig, sanitizeConfigForDisplay } from './config/index.js';
import { StreamingCliRenderer, StreamingEventLogStore } from './streaming/index.js';
import type { StreamingMode, StreamingThinkingMode } from './streaming/index.js';
import { cliHelpTopics, helpTopicFromArgs, renderHelp, renderUnknownCommand, shouldTreatAsUnknownCommand } from './cli/help.js';
import { renderNovaVersion } from './cli/version.js';
import { dryRunBatch, loadBatchItems, runBatch } from './batch/index.js';
import type { BatchItem, BatchItemReport, BatchRunOptions } from './batch/index.js';
import { TuiReplayRenderer } from './tui/index.js';
import type { TuiReplayMode } from './tui/index.js';
import { providerDoctor, listProviderProfiles, getProviderProfile, resolveProviderRuntime, listProviderDirectory, getProviderDirectoryEntry, providerDirectorySummary } from './providers/index.js';
import { handleHeartbeatCommand } from './heartbeat/index.js';
import { handleEvalCommand } from './eval/report_cli.js';

let dotenvLoaded = false;
async function loadDotenvOnce(): Promise<void> {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  await import('dotenv/config');
}

function getArg(name: string): string | undefined {
  const directIndex = process.argv.indexOf(`--${name}`);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  const prefix = `--${name}=`;
  const prefixed = process.argv.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function boolValue(value: string | undefined, fallback: boolean | undefined): boolean | undefined {
  if (value === undefined) return fallback;
  return value !== '0' && value !== 'false' && value !== 'no';
}

function intValue(value: string | undefined, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function streamingModeValue(value: string | undefined, fallback?: StreamingMode): StreamingMode | undefined {
  return value === 'compact' || value === 'normal' || value === 'verbose' ? value : fallback;
}

function thinkingModeValue(value: string | undefined, fallback?: StreamingThinkingMode): StreamingThinkingMode | undefined {
  return value === 'hidden' || value === 'collapsed' || value === 'expanded' ? value : fallback;
}

function providerRuntimeFor(projectConfig: ReturnType<typeof requireValidProjectConfig>) {
  return resolveProviderRuntime({
    cliProfileId: getArg('provider-profile'),
    cliFallback: getArg('provider-fallback'),
    env: process.env,
    project: projectConfig,
  });
}

// ─── Configuration ─────────────────────────────────────────────────────────

function loadConfig(): AgentConfig {
  const projectConfig = requireValidProjectConfig();
  const providerRuntime = providerRuntimeFor(projectConfig);
  if (providerRuntime.errors.length) throw new Error(`Invalid provider configuration: ${providerRuntime.errors.join('; ')}`);
  const llm: LLMConfig = {
    providerProfile: providerRuntime.primary.id,
    fallbackProfiles: providerRuntime.fallbackProfileIds,
    provider: providerRuntime.primary.provider,
    baseUrl: providerRuntime.primary.baseUrl,
    apiKey: process.env.LLM_API_KEY || '',
    model: providerRuntime.primary.model,
    maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : projectConfig?.llm?.maxTokens,
    robustness: {
      timeoutMs: intValue(process.env.NOVA_LLM_TIMEOUT_MS, projectConfig?.llm?.robustness?.timeoutMs),
      retries: intValue(process.env.NOVA_LLM_RETRIES, projectConfig?.llm?.robustness?.retries),
      retryBackoffMs: intValue(process.env.NOVA_LLM_RETRY_BACKOFF_MS, projectConfig?.llm?.robustness?.retryBackoffMs),
      retryBackoffMultiplier: process.env.NOVA_LLM_RETRY_BACKOFF_MULTIPLIER ? Number(process.env.NOVA_LLM_RETRY_BACKOFF_MULTIPLIER) : projectConfig?.llm?.robustness?.retryBackoffMultiplier,
    },
    pricing: {
      currency: process.env.LLM_PRICING_CURRENCY || projectConfig?.llm?.pricing?.currency || 'USD',
      inputCostPer1MTokens: process.env.LLM_INPUT_COST_PER_1M_TOKENS ? Number(process.env.LLM_INPUT_COST_PER_1M_TOKENS) : projectConfig?.llm?.pricing?.inputCostPer1MTokens,
      outputCostPer1MTokens: process.env.LLM_OUTPUT_COST_PER_1M_TOKENS ? Number(process.env.LLM_OUTPUT_COST_PER_1M_TOKENS) : projectConfig?.llm?.pricing?.outputCostPer1MTokens,
      source: process.env.LLM_PRICING_SOURCE || projectConfig?.llm?.pricing?.source || 'env',
    },
  };

  // Load soul.md for system prompt
  let soulContent = '';
  try {
    soulContent = readFileSync(resolve('soul.md'), 'utf-8');
  } catch {
    soulContent = 'You are Nova, an autonomous AI agent. Follow your principles and use tools effectively.';
  }

  const baseConfig: AgentConfig = {
    llm,
    systemPrompt: soulContent,
    maxSteps: process.env.NOVA_MAX_STEPS ? parseInt(process.env.NOVA_MAX_STEPS) : projectConfig?.maxSteps,
    policy: {
      enabled: process.env.NOVA_POLICY_ENABLED ? process.env.NOVA_POLICY_ENABLED !== '0' && process.env.NOVA_POLICY_ENABLED !== 'false' : projectConfig?.policy?.enabled,
      profileId: process.env.NOVA_POLICY_PROFILE || projectConfig?.policy?.profileId,
      approvalProvided: false,
    },
    trace: {
      enabled: process.env.NOVA_TRACE ? process.env.NOVA_TRACE === '1' || process.env.NOVA_TRACE === 'true' : projectConfig?.trace?.enabled,
      outputDir: process.env.NOVA_TRACE_DIR || projectConfig?.trace?.outputDir || '.nova/traces',
      includeContent: process.env.NOVA_TRACE_INCLUDE_CONTENT ? process.env.NOVA_TRACE_INCLUDE_CONTENT !== 'false' : projectConfig?.trace?.includeContent,
      contentMaxChars: process.env.NOVA_TRACE_CONTENT_MAX_CHARS ? parseInt(process.env.NOVA_TRACE_CONTENT_MAX_CHARS) : projectConfig?.trace?.contentMaxChars,
      writeJsonlIndex: projectConfig?.trace?.writeJsonlIndex,
      includeErrorStack: process.env.NOVA_TRACE_DEBUG_STACKS ? process.env.NOVA_TRACE_DEBUG_STACKS === '1' || process.env.NOVA_TRACE_DEBUG_STACKS === 'true' : projectConfig?.trace?.includeErrorStack,
    },
    context: {
      enabled: process.env.NOVA_CONTEXT_ENABLED ? process.env.NOVA_CONTEXT_ENABLED !== '0' && process.env.NOVA_CONTEXT_ENABLED !== 'false' : projectConfig?.context?.enabled,
      tokenBudget: process.env.NOVA_CONTEXT_TOKEN_BUDGET ? parseInt(process.env.NOVA_CONTEXT_TOKEN_BUDGET) : projectConfig?.context?.tokenBudget,
      userOrgTokenBudget: process.env.NOVA_CONTEXT_USER_ORG_TOKEN_BUDGET ? parseInt(process.env.NOVA_CONTEXT_USER_ORG_TOKEN_BUDGET) : projectConfig?.context?.userOrgTokenBudget,
      memoryTokenBudget: process.env.NOVA_CONTEXT_MEMORY_TOKEN_BUDGET ? parseInt(process.env.NOVA_CONTEXT_MEMORY_TOKEN_BUDGET) : projectConfig?.context?.memoryTokenBudget,
      capabilityTokenBudget: process.env.NOVA_CONTEXT_CAPABILITY_TOKEN_BUDGET ? parseInt(process.env.NOVA_CONTEXT_CAPABILITY_TOKEN_BUDGET) : projectConfig?.context?.capabilityTokenBudget,
      includeBudgetReport: process.env.NOVA_CONTEXT_BUDGET_REPORT ? process.env.NOVA_CONTEXT_BUDGET_REPORT !== '0' && process.env.NOVA_CONTEXT_BUDGET_REPORT !== 'false' : projectConfig?.context?.includeBudgetReport,
      includeUserOrgMemory: projectConfig?.context?.includeUserOrgMemory,
      includeProjectMemory: projectConfig?.context?.includeProjectMemory,
      includeCapabilities: projectConfig?.context?.includeCapabilities,
      suggestionThreshold: process.env.NOVA_CONTEXT_SUGGESTION_THRESHOLD ? Number(process.env.NOVA_CONTEXT_SUGGESTION_THRESHOLD) : projectConfig?.context?.suggestionThreshold,
      maxSkillSuggestions: process.env.NOVA_CONTEXT_MAX_SKILL_SUGGESTIONS ? parseInt(process.env.NOVA_CONTEXT_MAX_SKILL_SUGGESTIONS) : projectConfig?.context?.maxSkillSuggestions,
      maxMcpSuggestions: process.env.NOVA_CONTEXT_MAX_MCP_SUGGESTIONS ? parseInt(process.env.NOVA_CONTEXT_MAX_MCP_SUGGESTIONS) : projectConfig?.context?.maxMcpSuggestions,
      includeConversationSummary: process.env.NOVA_CONTEXT_CONVERSATION_SUMMARY ? process.env.NOVA_CONTEXT_CONVERSATION_SUMMARY !== '0' && process.env.NOVA_CONTEXT_CONVERSATION_SUMMARY !== 'false' : projectConfig?.context?.includeConversationSummary,
    },
    streaming: {
      enabled: boolValue(process.env.NOVA_STREAMING, projectConfig?.streaming?.enabled),
      mode: streamingModeValue(process.env.NOVA_STREAMING_MODE, projectConfig?.streaming?.mode),
      showTokens: boolValue(process.env.NOVA_STREAMING_SHOW_TOKENS, projectConfig?.streaming?.showTokens),
      showTools: boolValue(process.env.NOVA_STREAMING_SHOW_TOOLS, projectConfig?.streaming?.showTools),
      showThinking: boolValue(process.env.NOVA_STREAMING_SHOW_THINKING, projectConfig?.streaming?.showThinking),
      thinkingMode: thinkingModeValue(process.env.NOVA_STREAMING_THINKING_MODE, projectConfig?.streaming?.thinkingMode),
      showMetrics: boolValue(process.env.NOVA_STREAMING_SHOW_METRICS, projectConfig?.streaming?.showMetrics),
      showCost: boolValue(process.env.NOVA_STREAMING_SHOW_COST, projectConfig?.streaming?.showCost),
      refreshMs: intValue(process.env.NOVA_STREAMING_REFRESH_MS, projectConfig?.streaming?.refreshMs),
      eventLog: {
        enabled: boolValue(process.env.NOVA_STREAMING_EVENT_LOG, projectConfig?.streaming?.eventLog?.enabled),
        root: process.env.NOVA_STREAMING_EVENT_LOG_ROOT || projectConfig?.streaming?.eventLog?.root,
        includeText: boolValue(process.env.NOVA_STREAMING_EVENT_LOG_INCLUDE_TEXT, projectConfig?.streaming?.eventLog?.includeText),
        maxTextChars: intValue(process.env.NOVA_STREAMING_EVENT_LOG_MAX_TEXT_CHARS, projectConfig?.streaming?.eventLog?.maxTextChars),
        maxEvents: intValue(process.env.NOVA_STREAMING_EVENT_LOG_MAX_EVENTS, projectConfig?.streaming?.eventLog?.maxEvents),
      },
    },
    memory: {
      ...projectConfig?.memory,
      projectRoot: process.env.NOVA_MEMORY_PROJECT_ROOT,
      memoryRoot: process.env.NOVA_MEMORY_ROOT || projectConfig?.memory?.memoryRoot,
      enabled: process.env.NOVA_MEMORY_ENABLED ? process.env.NOVA_MEMORY_ENABLED === '1' || process.env.NOVA_MEMORY_ENABLED === 'true' : projectConfig?.memory?.enabled,
      tokenBudget: process.env.NOVA_MEMORY_TOKEN_BUDGET ? parseInt(process.env.NOVA_MEMORY_TOKEN_BUDGET) : projectConfig?.memory?.tokenBudget,
      policyProfileId: process.env.NOVA_MEMORY_POLICY_PROFILE || projectConfig?.memory?.policyProfileId,
    },
    session: {
      enabled: process.env.NOVA_SESSION_ENABLED ? process.env.NOVA_SESSION_ENABLED === '1' || process.env.NOVA_SESSION_ENABLED === 'true' : projectConfig?.session?.enabled,
      projectRoot: process.env.NOVA_SESSION_PROJECT_ROOT,
      sessionsRoot: process.env.NOVA_SESSION_ROOT || projectConfig?.session?.sessionsRoot,
      defaultSessionId: process.env.NOVA_SESSION_ID || projectConfig?.session?.defaultSessionId,
      autoCreate: process.env.NOVA_SESSION_AUTO_CREATE ? process.env.NOVA_SESSION_AUTO_CREATE !== '0' && process.env.NOVA_SESSION_AUTO_CREATE !== 'false' : projectConfig?.session?.autoCreate,
      title: process.env.NOVA_SESSION_TITLE || projectConfig?.session?.title,
      userId: process.env.NOVA_USER_ID,
      projectId: process.env.NOVA_PROJECT_ID || projectConfig?.session?.projectId,
      tags: process.env.NOVA_SESSION_TAGS ? process.env.NOVA_SESSION_TAGS.split(',').map((tag) => tag.trim()).filter(Boolean) : projectConfig?.session?.tags,
      defaultBudget: {
        ...projectConfig?.runs,
        ...projectConfig?.session?.defaultBudget,
        maxToolCalls: process.env.NOVA_RUN_MAX_TOOL_CALLS ? parseInt(process.env.NOVA_RUN_MAX_TOOL_CALLS) : projectConfig?.session?.defaultBudget?.maxToolCalls ?? projectConfig?.runs?.maxToolCalls,
        maxDurationMs: process.env.NOVA_RUN_MAX_DURATION_MS ? parseInt(process.env.NOVA_RUN_MAX_DURATION_MS) : projectConfig?.session?.defaultBudget?.maxDurationMs ?? projectConfig?.runs?.maxDurationMs,
        maxInputTokens: process.env.NOVA_RUN_MAX_INPUT_TOKENS ? parseInt(process.env.NOVA_RUN_MAX_INPUT_TOKENS) : projectConfig?.session?.defaultBudget?.maxInputTokens ?? projectConfig?.runs?.maxInputTokens,
        maxOutputTokens: process.env.NOVA_RUN_MAX_OUTPUT_TOKENS ? parseInt(process.env.NOVA_RUN_MAX_OUTPUT_TOKENS) : projectConfig?.session?.defaultBudget?.maxOutputTokens ?? projectConfig?.runs?.maxOutputTokens,
        maxTotalTokens: process.env.NOVA_RUN_MAX_TOTAL_TOKENS ? parseInt(process.env.NOVA_RUN_MAX_TOTAL_TOKENS) : projectConfig?.session?.defaultBudget?.maxTotalTokens ?? projectConfig?.runs?.maxTotalTokens,
        maxEstimatedCost: process.env.NOVA_RUN_MAX_ESTIMATED_COST ? Number(process.env.NOVA_RUN_MAX_ESTIMATED_COST) : projectConfig?.session?.defaultBudget?.maxEstimatedCost ?? projectConfig?.runs?.maxEstimatedCost,
        currency: process.env.LLM_PRICING_CURRENCY || projectConfig?.session?.defaultBudget?.currency || projectConfig?.runs?.currency || 'USD',
      },
      conversation: {
        enabled: process.env.NOVA_CONVERSATION_ENABLED ? process.env.NOVA_CONVERSATION_ENABLED !== '0' && process.env.NOVA_CONVERSATION_ENABLED !== 'false' : projectConfig?.session?.conversation?.enabled,
        maxTurns: process.env.NOVA_CONVERSATION_MAX_TURNS ? parseInt(process.env.NOVA_CONVERSATION_MAX_TURNS) : projectConfig?.session?.conversation?.maxTurns,
        keepRecentTurns: process.env.NOVA_CONVERSATION_KEEP_RECENT_TURNS ? parseInt(process.env.NOVA_CONVERSATION_KEEP_RECENT_TURNS) : projectConfig?.session?.conversation?.keepRecentTurns,
        maxPreviewChars: process.env.NOVA_CONVERSATION_MAX_PREVIEW_CHARS ? parseInt(process.env.NOVA_CONVERSATION_MAX_PREVIEW_CHARS) : projectConfig?.session?.conversation?.maxPreviewChars,
        summaryMaxChars: process.env.NOVA_CONVERSATION_SUMMARY_MAX_CHARS ? parseInt(process.env.NOVA_CONVERSATION_SUMMARY_MAX_CHARS) : projectConfig?.session?.conversation?.summaryMaxChars,
      },
    },
    toolConstraints: projectConfig?.toolConstraints,
  };
  return resolveConfigProfile(baseConfig, { profileId: getArg('profile') || process.env.NOVA_PROFILE || projectConfig?.profile, mode: 'root' });
}

function shouldStream(config: AgentConfig): boolean {
  if (hasFlag('no-stream')) return false;
  if (hasFlag('stream')) return true;
  return config.streaming?.enabled === true;
}

function streamingConfigForCli(config: AgentConfig): AgentConfig['streaming'] {
  return {
    ...config.streaming,
    mode: hasFlag('stream-compact') ? 'compact' : hasFlag('stream-verbose') ? 'verbose' : streamingModeValue(getArg('stream-mode'), config.streaming?.mode),
    thinkingMode: thinkingModeValue(getArg('thinking'), config.streaming?.thinkingMode),
    showMetrics: hasFlag('no-stream-metrics') ? false : config.streaming?.showMetrics,
    showTools: hasFlag('no-stream-tools') ? false : config.streaming?.showTools,
  };
}

function promptArgs(): string[] {
  const result: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile' || arg === '--provider-profile' || arg === '--provider-fallback' || arg === '--report' || arg === '--report-md' || arg === '--limit' || arg === '--only' || arg === '--from' || arg === '--out' || arg === '--md') { index += 1; continue; }
    if (arg.startsWith('--profile=')) continue;
    if (arg.startsWith('--provider-profile=')) continue;
    if (arg.startsWith('--provider-fallback=')) continue;
    if (arg.startsWith('--report=')) continue;
    if (arg.startsWith('--report-md=')) continue;
    if (arg === '--stream' || arg === '--no-stream' || arg === '--stream-compact' || arg === '--stream-verbose' || arg === '--no-stream-metrics' || arg === '--no-stream-tools' || arg === '--event-log' || arg === '--continue-on-error' || arg === '--dry-run' || arg === '--ci') continue;
    if (arg === '--thinking' || arg === '--stream-mode') { index += 1; continue; }
    if (arg.startsWith('--thinking=') || arg.startsWith('--stream-mode=')) continue;
    result.push(arg);
  }
  return result;
}

function positionalArgs(args: string[]): string[] {
  const values: string[] = [];
  const optionsWithValues = new Set(['profile', 'provider-profile', 'provider-fallback', 'stream-mode', 'thinking', 'report', 'report-md', 'limit', 'only', 'from']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0] ?? '';
      if (optionsWithValues.has(name) && !arg.includes('=')) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function requireValidProjectConfig() {
  const result = readProjectConfig();
  if (!result.ok) throw new Error(`Invalid Nova project config at ${result.path}: ${result.errors.join('; ')}`);
  return result.config;
}

function setupTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  if (process.env.NOVA_ENABLE_WRITE_TOOLS === '1' || process.env.NOVA_ENABLE_WRITE_TOOLS === 'true') {
    registry.register(writeFileTool);
    registry.register(bashTool);
  }
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(listDirectoryTool);
  registry.register(getFileInfoTool);
  registry.register(readPdfTool);
  registry.register(readDocxTool);
  registry.register(readExcelTool);
  registry.register(webSearchTool);
  registry.register(gitTool);
  registry.register(todoTool);
  registry.register(goalTool);
  registry.register(skillTool);
  return registry;
}

async function handleRuntimeCommand(config: AgentConfig, args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (!['sessions', 'runs', 'approvals', 'conversations', 'streaming'].includes(area ?? '')) return false;
  const sessionConfig = { ...config.session, enabled: true };
  const store = new SessionStore(sessionConfig);
  const currentStore = new CurrentSessionStore(sessionConfig);
  if (area === 'streaming') {
    const eventStore = new StreamingEventLogStore({ ...config.streaming?.eventLog, enabled: true });
    if (action === 'logs' || action === 'list') { console.log(JSON.stringify(await eventStore.list(), null, 2)); return true; }
    if ((action === 'show' || action === 'read') && rest[0]) { console.log(JSON.stringify(await eventStore.read(rest[0]), null, 2)); return true; }
    if (action === 'replay' && rest[0]) {
      const renderer = new StreamingCliRenderer(streamingConfigForCli({ ...config, streaming: { ...config.streaming, enabled: true } }));
      for (const event of await eventStore.read(rest[0])) renderer.handle(event);
      return true;
    }
    if (action === 'show' || action === 'read' || action === 'replay') return missingArgument(`nova streaming ${action} <logId>`, 'streaming');
  }
  if (area === 'sessions') {
    if (action === 'list') { console.log(JSON.stringify(await store.listSessions(), null, 2)); return true; }
    if (action === 'show' && rest[0]) { console.log(JSON.stringify(await store.getSession(rest[0]) ?? null, null, 2)); return true; }
    if (action === 'current') { console.log(JSON.stringify(await currentStore.get() ?? null, null, 2)); return true; }
    if (action === 'use' && rest[0]) {
      const session = await store.getSession(rest[0]);
      if (!session) throw new Error(`Unknown session: ${rest[0]}`);
      console.log(JSON.stringify(await currentStore.set({ sessionId: session.id, runId: session.activeRunId, source: 'cli' }), null, 2));
      return true;
    }
    if (action === 'unset-current') { console.log(JSON.stringify(await currentStore.unset(), null, 2)); return true; }
    if (action === 'show' || action === 'use') return missingArgument(`nova sessions ${action} <sessionId>`, 'sessions');
  }
  if (area === 'runs') {
    if (action === 'list') { console.log(JSON.stringify(await store.listRuns(rest[0]), null, 2)); return true; }
    if (action === 'show' && rest[0] && rest[1]) { console.log(JSON.stringify(await store.getRun(rest[0], rest[1]) ?? null, null, 2)); return true; }
    if (action === 'current') {
      const current = await currentStore.requireCurrent();
      console.log(JSON.stringify(current.runId ? await store.getRun(current.sessionId, current.runId) ?? current : current, null, 2));
      return true;
    }
    if ((action === 'replay' || action === 'report') && rest[0] && rest[1]) {
      const manager = new RunReplayManager(sessionConfig);
      console.log(JSON.stringify(await manager.replay(rest[0], rest[1]), null, 2));
      return true;
    }
    if (action === 'report-current') {
      const current = await currentStore.requireCurrent();
      if (!current.runId) throw new Error('Current session has no current run');
      const manager = new RunReplayManager(sessionConfig);
      console.log(JSON.stringify(await manager.replay(current.sessionId, current.runId), null, 2));
      return true;
    }
    if (action === 'resume' && rest[0] && rest[1]) {
      const manager = new RunResumeManager(sessionConfig);
      console.log(JSON.stringify(await manager.resume({ sessionId: rest[0], runId: rest[1], reason: rest.slice(2).join(' ') || undefined }), null, 2));
      return true;
    }
    if (action === 'resume-current') {
      const current = await currentStore.requireCurrent();
      if (!current.runId) throw new Error('Current session has no current run');
      const manager = new RunResumeManager(sessionConfig);
      console.log(JSON.stringify(await manager.resume({ sessionId: current.sessionId, runId: current.runId, reason: rest.join(' ') || undefined }), null, 2));
      return true;
    }
    if (action === 'show') return missingArgument('nova runs show <sessionId> <runId>', 'runs');
    if (action === 'replay' || action === 'report' || action === 'resume') return missingArgument(`nova runs ${action} <sessionId> <runId> [reason]`, 'runs');
  }
  if (area === 'approvals') {
    const manager = new ApprovalManager(sessionConfig);
    if (action === 'list') { console.log(JSON.stringify(await manager.list('pending'), null, 2)); return true; }
    if ((action === 'approve' || action === 'deny') && rest[0]) {
      console.log(JSON.stringify(await manager.decide({ approvalId: rest[0], decision: action === 'approve' ? 'approved' : 'denied', reason: rest.slice(1).join(' ') || undefined }), null, 2));
      return true;
    }
    if (action === 'approve' || action === 'deny') return missingArgument(`nova approvals ${action} <approvalId> [reason]`, 'approvals');
  }
  if (area === 'conversations') {
    const conversations = new ConversationStore(sessionConfig);
    if (action === 'show') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.get(sessionId) ?? null, null, 2)); return true; }
    if (action === 'summary') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.summary(sessionId), null, 2)); return true; }
    if (action === 'compact') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.compact(sessionId), null, 2)); return true; }
  }
  console.error(chalk.red(renderUnknownCommand(args, area as Parameters<typeof renderUnknownCommand>[1])));
  process.exitCode = 1;
  return true;
}

function missingArgument(usage: string, topic: Parameters<typeof renderHelp>[0]): true {
  console.error(chalk.red(`Missing argument. Usage: ${usage}`));
  console.error('');
  console.error(renderHelp(topic));
  process.exitCode = 1;
  return true;
}

async function handleConfigCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'config') return false;
  const result = readProjectConfig();
  if (action === 'validate') { console.log(JSON.stringify({ path: result.path, present: result.present, ok: result.ok, errors: result.errors }, null, 2)); process.exitCode = result.ok ? 0 : 1; return true; }
  if (action === 'explain') { console.log(explainProjectConfig(result.config).join('\n')); if (!result.ok) process.exitCode = 1; return true; }
  if (action === 'init') { const force = rest.includes('--force'); const initialized = initProjectConfig(process.cwd(), force); console.log(JSON.stringify({ path: initialized.path, ok: initialized.ok, errors: initialized.errors, config: initialized.config }, null, 2)); process.exitCode = initialized.ok ? 0 : 1; return true; }
  if (action === 'show') {
    const runtime = result.ok ? sanitizeConfigForDisplay(loadConfig()) : null;
    console.log(JSON.stringify({ project: result, runtime }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return true;
  }
  console.error(chalk.red(renderUnknownCommand(args, 'config')));
  process.exitCode = 1;
  return true;
}

async function handleProvidersCommand(args: string[]): Promise<boolean> {
  const areaIndex = args.indexOf('providers');
  if (areaIndex < 0) return false;
  const [action, ...rest] = positionalArgs(args.slice(areaIndex + 1));
  if (action === 'list' || action === undefined) {
    console.log(JSON.stringify({ directory: listProviderDirectory(), profiles: listProviderProfiles(), summary: providerDirectorySummary() }, null, 2));
    return true;
  }
  if (action === 'show' && rest[0]) {
    const profile = getProviderProfile(rest[0]);
    const directoryEntry = getProviderDirectoryEntry(rest[0]);
    if (directoryEntry) {
      console.log(JSON.stringify({ directory: directoryEntry, profiles: directoryEntry.profileIds?.map((id) => getProviderProfile(id)).filter(Boolean) ?? [] }, null, 2));
      return true;
    }
    if (!profile) {
      console.error(chalk.red(`Unknown provider or profile: ${rest[0]}`));
      process.exitCode = 1;
      return true;
    }
    console.log(JSON.stringify(profile, null, 2));
    return true;
  }
  if (action === 'doctor') {
    await loadDotenvOnce();
    const projectConfig = requireValidProjectConfig();
    const resolved = providerRuntimeFor(projectConfig);
    const report = providerDoctor(resolved, process.env);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return true;
  }
  if (action === 'show') return missingArgument('nova providers show <id>', 'providers');
  console.error(chalk.red(renderUnknownCommand(args, 'providers')));
  process.exitCode = 1;
  return true;
}

async function handleBatchCommand(config: AgentConfig | undefined, args: string[]): Promise<boolean> {
  if (args[0] !== 'batch') return false;
  const file = positionalArgs(args.slice(1))[0];
  if (!file) return missingArgument('nova batch <file> [--dry-run] [--limit N] [--only id1,id2] [--from id] [--report-md path] [--ci]', 'batch');
  let batchOptions: BatchRunOptions;
  try {
    batchOptions = parseBatchOptions(config);
  } catch (err) {
    console.error(chalk.red(`✖ Batch option error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return true;
  }
  try {
    await loadBatchItems(file);
  } catch (err) {
    console.error(chalk.red(`✖ Batch input error: ${err instanceof Error ? err.message : String(err)}`));
    console.error('Run nova batch --help for supported .txt/.json formats.');
    process.exitCode = 1;
    return true;
  }
  if (batchOptions.dryRun) {
    try {
      const report = await dryRunBatch(file, batchOptions);
      if (batchOptions.ci) printBatchCiSummary(report);
      else {
        printBatchDryRun(report.items.filter((item) => item.skipReason === 'Dry run: item validated but not executed.'), report.items.filter((item) => item.skipReason && item.skipReason !== 'Dry run: item validated but not executed.'));
        console.log(chalk.gray(`Report: ${report.reportPath}`));
        if (report.reportMarkdownPath) console.log(chalk.gray(`Markdown report: ${report.reportMarkdownPath}`));
      }
      process.exitCode = 0;
      return true;
    } catch (err) {
      console.error(chalk.red(`✖ Batch dry-run error: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
      return true;
    }
  }
  if (!config) return false;
  if (!config.llm.apiKey) {
    console.error(chalk.red('✖ Error: LLM_API_KEY not set. Batch mode executes prompts and requires an LLM key.'));
    process.exitCode = 1;
    return true;
  }
  const tools = setupTools();
  const report = await runBatch(config, tools, file, {
    ...batchOptions,
    onItemStart: batchOptions.ci ? ({ item, index, total }) => printBatchCiItemStart(item, index, total) : ({ item, index, total }) => printBatchItemStart(item, index, total),
    onItemFinish: batchOptions.ci ? ({ report, index, total }) => printBatchCiItemFinish(report, index, total) : ({ report, index, total }) => printBatchItemFinish(report, index, total),
  });
  if (batchOptions.ci) printBatchCiSummary(report);
  else printBatchSummary(report);
  process.exitCode = report.status === 'completed' ? 0 : 1;
  return true;
}

function parseBatchOptions(config?: AgentConfig): BatchRunOptions {
  const ci = hasFlag('ci');
  const limitValue = getArg('limit');
  const limit = limitValue === undefined ? undefined : parseInt(limitValue, 10);
  if (limitValue !== undefined && (!Number.isFinite(limit ?? NaN) || (limit ?? 0) < 1)) throw new Error('--limit must be a positive integer');
  const onlyValue = getArg('only');
  const onlyIds = onlyValue === undefined ? undefined : onlyValue.split(',').map((id) => id.trim()).filter(Boolean);
  if (onlyValue !== undefined && !onlyIds?.length) throw new Error('--only must contain at least one item id');
  const fromId = getArg('from');
  if (fromId !== undefined && !fromId.trim()) throw new Error('--from must contain an item id');
  const reportPath = pathValue('report');
  const reportMarkdownPath = pathValue('report-md');
  return {
    streaming: ci || !config ? false : shouldStream(config),
    eventLog: hasFlag('event-log'),
    reportPath,
    reportMarkdownPath,
    ci,
    continueOnError: hasFlag('continue-on-error'),
    dryRun: hasFlag('dry-run'),
    limit,
    onlyIds,
    fromId,
  };
}

function pathValue(name: string): string | undefined {
  const value = getArg(name);
  if (value === undefined) {
    if (hasFlag(name)) throw new Error(`--${name} requires a path`);
    return undefined;
  }
  if (!value.trim() || value.startsWith('-')) throw new Error(`--${name} requires a path`);
  return value;
}

function printBatchItemStart(item: BatchItem, index: number, total: number): void {
  console.log(chalk.cyan(`\n[${index}/${total}] ${item.id}`));
}

function printBatchItemFinish(report: BatchItemReport, index: number, total: number): void {
  const icon = report.status === 'success' ? chalk.green('✓') : report.status === 'error' ? chalk.red('✖') : chalk.gray('-');
  const detail = report.status === 'success' ? report.answerPreview : report.error ?? report.skipReason;
  console.log(`${icon} [${index}/${total}] ${report.id} ${chalk.gray(`${report.durationMs}ms`)}${detail ? ` — ${detail}` : ''}`);
}

function printBatchDryRun(selected: BatchItemReport[], skipped: BatchItemReport[]): void {
  console.log(chalk.cyanBright.bold('Batch dry-run'));
  console.log(chalk.gray(`validated ${selected.length} selected item(s), ${skipped.length} skipped by filters`));
  for (const item of selected) console.log(`${chalk.green('✓')} ${item.id} ${chalk.gray(item.promptPreview)}`);
  for (const item of skipped) console.log(`${chalk.gray('-')} ${item.id} ${chalk.gray(item.skipReason ?? 'skipped')}`);
}

function printBatchSummary(report: Awaited<ReturnType<typeof runBatch>>): void {
  console.log('');
  console.log(chalk.cyanBright.bold('Batch summary'));
  console.log(`status=${report.status} success=${report.counts.success} error=${report.counts.error} skipped=${report.counts.skipped} total=${report.counts.total}`);
  console.log(chalk.gray(`Report: ${report.reportPath}`));
  if (report.reportMarkdownPath) console.log(chalk.gray(`Markdown report: ${report.reportMarkdownPath}`));
}

function printBatchCiItemStart(item: BatchItem, index: number, total: number): void {
  console.log(`BATCH_ITEM_START index=${index} total=${total} id=${item.id}`);
}

function printBatchCiItemFinish(report: BatchItemReport, index: number, total: number): void {
  console.log(`BATCH_ITEM_RESULT index=${index} total=${total} id=${report.id} status=${report.status} durationMs=${report.durationMs}`);
}

function printBatchCiSummary(report: Awaited<ReturnType<typeof runBatch>>): void {
  console.log(`BATCH_SUMMARY status=${report.status} total=${report.counts.total} success=${report.counts.success} error=${report.counts.error} skipped=${report.counts.skipped} durationMs=${report.durationMs}`);
  console.log(`BATCH_REPORT_JSON path=${report.reportPath ?? ''}`);
  if (report.reportMarkdownPath) console.log(`BATCH_REPORT_MD path=${report.reportMarkdownPath}`);
  for (const item of report.items) console.log(`BATCH_ITEM id=${item.id} status=${item.status} durationMs=${item.durationMs}`);
}

async function handleTuiCommand(config: AgentConfig, args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'tui') return false;
  const eventStore = new StreamingEventLogStore({ ...config.streaming?.eventLog, enabled: true });
  let mode: TuiReplayMode;
  try {
    mode = parseTuiMode();
  } catch (err) {
    console.error(chalk.red(`✖ TUI option error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return true;
  }
  const logId = rest.find((value) => !value.startsWith('-'));
  if (action === 'replay' && logId) {
    const events = await eventStore.read(logId);
    console.log(new TuiReplayRenderer().render(events, { title: `Nova TUI replay · ${logId}`, mode }));
    return true;
  }
  if (action === 'latest') {
    const latest = (await eventStore.list())[0];
    if (!latest) {
      console.error(chalk.red('No streaming event logs found. Run with NOVA_STREAMING_EVENT_LOG=true or --event-log first.'));
      process.exitCode = 1;
      return true;
    }
    const events = await eventStore.read(latest.logId);
    console.log(new TuiReplayRenderer().render(events, { title: `Nova TUI latest · ${latest.logId}`, mode }));
    return true;
  }
  if (action === 'replay') return missingArgument('nova tui replay <logId> [--compact|--verbose|--mode compact|normal|verbose]', 'tui');
  console.error(chalk.red(renderUnknownCommand(args, 'tui')));
  process.exitCode = 1;
  return true;
}

function parseTuiMode(): TuiReplayMode {
  if (hasFlag('compact')) return 'compact';
  if (hasFlag('verbose')) return 'verbose';
  const value = getArg('mode');
  if (value === 'compact' || value === 'normal' || value === 'verbose') return value;
  if (value) throw new Error('--mode must be compact, normal, or verbose');
  return 'normal';
}

function handleHelpCommand(args: string[]): boolean {
  const topic = helpTopicFromArgs(args);
  if (!topic && args[0] === 'help') {
    console.error(chalk.red(renderUnknownCommand(args)));
    process.exitCode = 1;
    return true;
  }
  if (!topic) return false;
  console.log(renderHelp(topic));
  return true;
}

function handleVersionCommand(args: string[]): boolean {
  const [first] = args;
  if (first !== '--version' && first !== '-v' && first !== 'version') return false;
  console.log(renderNovaVersion());
  return true;
}

// ─── Display Helpers ────────────────────────────────────────────────────────

function showWelcome(): void {
  console.log('');
  console.log(chalk.cyanBright.bold('  ╔═══════════════════════════════════════╗'));
  console.log(chalk.cyanBright.bold('  ║        ⭐  NOVA AGENT  ⭐            ║'));
  console.log(chalk.cyanBright.bold('  ║   Autonomous General-Purpose Agent    ║'));
  console.log(chalk.cyanBright.bold('  ╚═══════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray('  Type "exit" or "quit" to stop.'));
  console.log(chalk.gray('  Type "reset" to clear conversation.'));
  console.log('');
}

function printSteps(steps: StepDisplay[]): void {
  for (const step of steps) {
    switch (step.type) {
      case 'reasoning':
        if (step.content.trim()) {
          console.log(chalk.yellow('  💭') + ' ' + step.content);
          console.log('');
        }
        break;
      case 'tool_call':
        console.log(chalk.blue('  🔧') + ' ' + chalk.bold(step.toolName) + '(' + chalk.gray(JSON.stringify(step.toolArgs)) + ')');
        break;
      case 'tool_result':
        const result = (step.toolResult || '').slice(0, 300);
        console.log(chalk.green('  📦 Result:') + ' ' + result);
        console.log('');
        break;
      case 'answer':
        console.log(chalk.magentaBright.bold('  ✦') + ' ' + step.content);
        console.log('');
        break;
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);
  if (handleVersionCommand(rawArgs)) return;
  if (handleHelpCommand(rawArgs)) return;
  if (await handleHeartbeatCommand(rawArgs)) return;
  if (await handleEvalCommand(rawArgs)) return;
  if (await handleConfigCommand(rawArgs)) return;
  if (await handleProvidersCommand(rawArgs)) return;
  if (await handleBatchCommand(undefined, rawArgs)) return;
  await loadDotenvOnce();
  const config = loadConfig();
  if (await handleTuiCommand(config, rawArgs)) return;
  if (await handleRuntimeCommand(config, rawArgs)) return;
  if (await handleBatchCommand(config, rawArgs)) return;
  if (shouldTreatAsUnknownCommand(rawArgs)) {
    console.error(chalk.red(renderUnknownCommand(rawArgs)));
    process.exitCode = 1;
    return;
  }
  if (rawArgs[0] && !rawArgs[0].startsWith('-') && cliHelpTopics.includes(rawArgs[0] as typeof cliHelpTopics[number])) {
    console.error(chalk.red(renderUnknownCommand(rawArgs, rawArgs[0] as typeof cliHelpTopics[number])));
    process.exitCode = 1;
    return;
  }

  // Check API key
  if (!config.llm.apiKey) {
    console.error(chalk.red('✖ Error: LLM_API_KEY not set. Copy .env.example to .env and add your key.'));
    process.exit(1);
  }

  // Setup agent
  const tools = setupTools();
  const agent = new NovaAgent(config, tools);

  // Single prompt mode
  const prompt = promptArgs().join(' ');
  if (prompt) {
    console.log(chalk.cyan('  You: ') + prompt);
    console.log('');
    const streaming = shouldStream(config);
    const renderer = streaming ? new StreamingCliRenderer(streamingConfigForCli(config)) : undefined;
    const steps = await agent.run(prompt, { streaming, onEvent: renderer?.handle });
    if (!streaming) printSteps(steps);
    process.exit(0);
  }

  // Interactive mode
  showWelcome();

  while (true) {
    const input = await text({
      message: 'What should Nova do?',
      placeholder: 'Type your request...',
    });

    if (isCancel(input)) {
      cancel('👋 Goodbye!');
      break;
    }

    const query = (input as string).trim();
    if (!query) continue;

    if (query === 'exit' || query === 'quit') {
      outro('Until next time, commander. ⭐');
      break;
    }

    if (query === 'reset') {
      agent.memory.clear();
      console.log(chalk.gray('  ↻ Conversation reset.'));
      continue;
    }

    const streaming = shouldStream(config);
    const renderer = streaming ? new StreamingCliRenderer(streamingConfigForCli(config)) : undefined;
    const spin = streaming ? undefined : spinner();
    spin?.start('Nova is thinking...');

    const steps = await agent.run(query, { streaming, onEvent: renderer?.handle });

    spin?.stop('Done');
    if (!streaming) {
      console.log('');
      printSteps(steps);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
