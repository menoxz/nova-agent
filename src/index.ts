#!/usr/bin/env node

/**
 * Nova Agent — Entrypoint
 *
 * Usage:
 *   npx tsx src/index.ts              → interactive mode
 *   npx tsx src/index.ts "prompt"     → single prompt mode
 */

import 'dotenv/config';
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

function getArg(name: string): string | undefined {
  const directIndex = process.argv.indexOf(`--${name}`);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  const prefix = `--${name}=`;
  const prefixed = process.argv.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : undefined;
}

// ─── Configuration ─────────────────────────────────────────────────────────

function loadConfig(): AgentConfig {
  const projectConfig = requireValidProjectConfig();
  const llm: LLMConfig = {
    provider: process.env.LLM_PROVIDER || projectConfig?.llm?.provider || 'openrouter',
    baseUrl: process.env.LLM_BASE_URL || projectConfig?.llm?.baseUrl || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || projectConfig?.llm?.model || 'openmodel/deepseek-v4-flash',
    maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : projectConfig?.llm?.maxTokens,
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
  if (!['sessions', 'runs', 'approvals', 'conversations'].includes(area ?? '')) return false;
  const sessionConfig = { ...config.session, enabled: true };
  const store = new SessionStore(sessionConfig);
  const currentStore = new CurrentSessionStore(sessionConfig);
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
  }
  if (area === 'approvals') {
    const manager = new ApprovalManager(sessionConfig);
    if (action === 'list') { console.log(JSON.stringify(await manager.list('pending'), null, 2)); return true; }
    if ((action === 'approve' || action === 'deny') && rest[0]) {
      console.log(JSON.stringify(await manager.decide({ approvalId: rest[0], decision: action === 'approve' ? 'approved' : 'denied', reason: rest.slice(1).join(' ') || undefined }), null, 2));
      return true;
    }
  }
  if (area === 'conversations') {
    const conversations = new ConversationStore(sessionConfig);
    if (action === 'show') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.get(sessionId) ?? null, null, 2)); return true; }
    if (action === 'summary') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.summary(sessionId), null, 2)); return true; }
    if (action === 'compact') { const sessionId = rest[0] ?? (await currentStore.requireCurrent()).sessionId; console.log(JSON.stringify(await conversations.compact(sessionId), null, 2)); return true; }
  }
  console.error(chalk.red(`Unknown runtime command: ${args.join(' ')}`));
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
  console.error(chalk.red(`Unknown config command: ${args.join(' ')}`));
  process.exitCode = 1;
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
  if (await handleConfigCommand(rawArgs)) return;
  const config = loadConfig();
  if (await handleRuntimeCommand(config, rawArgs)) return;

  // Check API key
  if (!config.llm.apiKey) {
    console.error(chalk.red('✖ Error: LLM_API_KEY not set. Copy .env.example to .env and add your key.'));
    process.exit(1);
  }

  // Setup agent
  const tools = setupTools();
  const agent = new NovaAgent(config, tools);

  // Single prompt mode
  const prompt = process.argv.slice(2).filter((arg, index, args) => {
    if (arg === '--profile') return false;
    if (args[index - 1] === '--profile') return false;
    if (arg.startsWith('--profile=')) return false;
    return true;
  }).join(' ');
  if (prompt) {
    console.log(chalk.cyan('  You: ') + prompt);
    console.log('');
    const steps = await agent.run(prompt);
    printSteps(steps);
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

    const spin = spinner();
    spin.start('Nova is thinking...');

    const steps = await agent.run(query);

    spin.stop('Done');
    console.log('');
    printSteps(steps);
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
