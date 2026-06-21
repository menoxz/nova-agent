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

// ─── Configuration ─────────────────────────────────────────────────────────

function loadConfig(): AgentConfig {
  const llm: LLMConfig = {
    provider: process.env.LLM_PROVIDER || 'openrouter',
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'openmodel/deepseek-v4-flash',
    maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : undefined,
  };

  // Load soul.md for system prompt
  let soulContent = '';
  try {
    soulContent = readFileSync(resolve('soul.md'), 'utf-8');
  } catch {
    soulContent = 'You are Nova, an autonomous AI agent. Follow your principles and use tools effectively.';
  }

  return {
    llm,
    systemPrompt: soulContent,
    maxSteps: 15,
    trace: {
      enabled: process.env.NOVA_TRACE === '1' || process.env.NOVA_TRACE === 'true',
      outputDir: process.env.NOVA_TRACE_DIR || '.nova/traces',
      includeContent: process.env.NOVA_TRACE_INCLUDE_CONTENT !== 'false',
      contentMaxChars: process.env.NOVA_TRACE_CONTENT_MAX_CHARS ? parseInt(process.env.NOVA_TRACE_CONTENT_MAX_CHARS) : undefined,
    },
  };
}

function setupTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(bashTool);
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
  const config = loadConfig();

  // Check API key
  if (!config.llm.apiKey) {
    console.error(chalk.red('✖ Error: LLM_API_KEY not set. Copy .env.example to .env and add your key.'));
    process.exit(1);
  }

  // Setup agent
  const tools = setupTools();
  const agent = new NovaAgent(config, tools);

  // Single prompt mode
  const prompt = process.argv.slice(2).join(' ');
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
