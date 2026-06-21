/**
 * Nova Agent — Tool: bash
 *
 * Anti-blocking shell command runner.
 *
 * Design goals:
 * - deterministic timeout and bounded output
 * - early refusal of commands that are likely interactive or long-running servers
 * - safe cwd/env validation
 * - stdin support without temp-file quoting hazards
 * - process-tree cleanup on timeout / output flood
 *
 * ⚠️ May modify system state — use with caution.
 */

import { z } from 'zod';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 200_000;
const KILL_GRACE_MS = 1_000;

type ShellSpec = {
  executable: string;
  args: (command: string) => string[];
  label: string;
};

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimited: boolean;
  durationMs: number;
  shell: string;
};

type CommandRisk = {
  blocked: boolean;
  reason?: string;
  matched?: string;
  suggestion?: string;
};

function shellCandidates(): ShellSpec[] {
  if (process.platform === 'win32') {
    return [
      {
        executable: 'pwsh.exe',
        label: 'PowerShell 7',
        args: command => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      },
      {
        executable: 'powershell.exe',
        label: 'Windows PowerShell',
        args: command => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      },
    ];
  }

  return [
    { executable: '/bin/bash', label: 'bash', args: command => ['-lc', command] },
    { executable: '/bin/sh', label: 'sh', args: command => ['-lc', command] },
  ];
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

function detectInteractiveOrLongRunning(command: string): CommandRisk {
  const c = normalizeCommand(command);

  const patterns: Array<{ re: RegExp; reason: string; suggestion: string }> = [
    { re: /(^|[;&|]\s*)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)(\s|$)/, reason: 'dev server / long-running package script', suggestion: 'Use a dedicated server/process manager, or pass allowLongRunning=true with a short timeout for a smoke test.' },
    { re: /(^|[;&|]\s*)(vite|next\s+dev|nuxt\s+dev|astro\s+dev|webpack\s+serve|parcel|turbo\s+dev)(\s|$)/, reason: 'frontend dev server', suggestion: 'Use allowLongRunning=true only for bounded smoke tests.' },
    { re: /(^|[;&|]\s*)(uvicorn|gunicorn|flask\s+run|fastapi\s+dev|python\s+-m\s+http\.server|http-server|serve)(\s|$)/, reason: 'web server', suggestion: 'Run with an explicit timeout or use a server-management tool.' },
    { re: /(^|[;&|]\s*)(docker\s+compose\s+up|docker-compose\s+up)(?!.*\s-d(\s|$))/, reason: 'foreground docker compose service', suggestion: 'Use docker compose up -d, or a docker-specific tool.' },
    { re: /(^|[;&|]\s*)(tail\s+-f|watch|top|htop|less|more)(\s|$)/, reason: 'interactive/streaming terminal command', suggestion: 'Use bounded alternatives such as tail -n, or pass allowLongRunning=true with timeout.' },
    { re: /(^|[;&|]\s*)(vim|vi|nano|emacs|code|notepad)(\s|$)/, reason: 'interactive editor', suggestion: 'Use file tools instead of opening an editor.' },
    { re: /(^|[;&|]\s*)(ssh|sftp|ftp|telnet|mysql|psql|sqlite3|redis-cli)(\s|$)/, reason: 'interactive network/database shell', suggestion: 'Use non-interactive flags or a dedicated database/SSH tool.' },
    { re: /(^|[;&|]\s*)(python|node|ruby|irb|php|pwsh|powershell|bash|sh)\s*$/, reason: 'bare REPL/shell command', suggestion: 'Provide a non-interactive command string, e.g. node -e "...".' },
    { re: /(^|[;&|]\s*)(passwd|sudo\s+-v|sudo\s+-i|su)(\s|$)/, reason: 'password/privilege prompt likely to block', suggestion: 'Avoid interactive privilege prompts in Nova bash.' },
  ];

  for (const pattern of patterns) {
    const match = c.match(pattern.re);
    if (match) {
      return {
        blocked: true,
        reason: pattern.reason,
        matched: match[0].trim(),
        suggestion: pattern.suggestion,
      };
    }
  }

  return { blocked: false };
}

async function validateCwd(workdir: unknown): Promise<string> {
  const cwd = resolve(typeof workdir === 'string' && workdir.trim() ? workdir : process.cwd());
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`workdir is not a directory: ${cwd}`);
  return cwd;
}

function buildEnv(input: unknown): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  if (!input) return merged;

  const env = input as Record<string, string>;
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env var name: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid env var value for ${key}: expected string`);
    }
    if (value.length > 8192) {
      throw new Error(`Env var ${key} is too large (>8192 chars)`);
    }
    merged[key] = value;
  }
  return merged;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function stripTrailingNewline(s: string): string {
  return s.replace(/[\r\n]+$/, '');
}

function formatOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) parts.push(stripTrailingNewline(stdout));
  if (stderr) parts.push(`[stderr]\n${stripTrailingNewline(stderr)}`);
  return parts.join('\n') || '(no output)';
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>(resolveDone => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const done = () => resolveDone();
      killer.once('exit', done);
      killer.once('error', () => {
        try { child.kill(); } catch {}
        resolveDone();
      });
      setTimeout(done, KILL_GRACE_MS).unref();
    });
    return;
  }

  try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  await new Promise(resolveDone => setTimeout(resolveDone, KILL_GRACE_MS));
  try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
}

async function runWithShell(params: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxOutputChars: number;
  shell: ShellSpec;
}): Promise<RunResult> {
  const started = Date.now();
  const child = spawn(params.shell.executable, params.shell.args(params.command), {
    cwd: params.cwd,
    env: params.env,
    windowsHide: true,
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  let stderr = '';
  let totalChars = 0;
  let timedOut = false;
  let outputLimited = false;
  let killStarted = false;

  const terminate = async (reason: 'timeout' | 'output') => {
    if (killStarted) return;
    killStarted = true;
    if (reason === 'timeout') timedOut = true;
    if (reason === 'output') outputLimited = true;
    await killProcessTree(child);
  };

  const append = (which: 'stdout' | 'stderr', chunk: Buffer) => {
    const text = chunk.toString('utf8');
    const remaining = params.maxOutputChars - totalChars;
    if (remaining > 0) {
      const slice = text.slice(0, remaining);
      if (which === 'stdout') stdout += slice;
      else stderr += slice;
      totalChars += slice.length;
    }
    if (text.length > remaining && !outputLimited) void terminate('output');
  };

  child.stdout.on('data', chunk => append('stdout', chunk));
  child.stderr.on('data', chunk => append('stderr', chunk));

  if (params.stdin !== undefined) child.stdin.end(params.stdin);
  else child.stdin.end();

  const timer = setTimeout(() => void terminate('timeout'), params.timeoutMs);

  return await new Promise<RunResult>((resolveRun, rejectRun) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.once('error', err => {
      settle(() => rejectRun(err));
    });

    child.once('close', (exitCode, signal) => {
      settle(() => resolveRun({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        outputLimited,
        durationMs: Date.now() - started,
        shell: params.shell.label,
      }));
    });
  });
}

async function runWithFallbackShells(params: Omit<Parameters<typeof runWithShell>[0], 'shell'>): Promise<RunResult> {
  const candidates = shellCandidates();
  let lastError: unknown;
  for (const shell of candidates) {
    try {
      return await runWithShell({ ...params, shell });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('No supported shell found.');
}

export const bashTool: NovaTool = {
  name: 'bash',
  description: 'Execute a bounded non-interactive shell command with timeout, output limits, safe cwd/env validation, interactive/server command detection, stdin support, and process-tree cleanup on timeout. ⚠️ Can modify system state — use with caution.',
  inputSchema: z.object({
    command: z.string().min(1).describe('The non-interactive shell command to execute'),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`),
    workdir: z.string().optional().describe('Working directory for the command (default: current process cwd). Must already exist and be a directory.'),
    description: z.string().optional().describe('Optional human-readable description of what this command does'),
    stdin: z.string().optional().describe('Text to pipe to the command stdin. Stdin is closed automatically to prevent prompts from blocking.'),
    env: z.record(z.string()).optional().describe('Additional environment variables. Names must match ^[A-Za-z_][A-Za-z0-9_]*$ and values are capped at 8192 chars.'),
    maxOutputChars: z.number().int().min(1000).max(MAX_OUTPUT_CHARS).optional().describe(`Combined stdout+stderr output cap (default: ${DEFAULT_MAX_OUTPUT_CHARS}, max: ${MAX_OUTPUT_CHARS}). The process is killed if it exceeds the cap.`),
    allowLongRunning: z.boolean().optional().describe('Default false. Set true only when intentionally smoke-testing a command detected as interactive or long-running; timeout/output limits still apply.'),
  }),
  execute: async ({ command, timeout, workdir, description, stdin, env, maxOutputChars, allowLongRunning }) => {
    const cmd = String(command);
    const cmdDescription = (description as string) || '';
    const context = cmdDescription ? `[${cmdDescription}] ` : '';
    const timeoutMs = clampNumber(timeout, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
    const outputLimit = clampNumber(maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, 1000, MAX_OUTPUT_CHARS);

    try {
      const risk = detectInteractiveOrLongRunning(cmd);
      if (risk.blocked && allowLongRunning !== true) {
        return `${context}Refused to run likely blocking command.\nReason: ${risk.reason}\nMatched: ${risk.matched}\nSuggestion: ${risk.suggestion}\nOverride: pass allowLongRunning=true with an explicit timeout for a bounded smoke test.`;
      }

      const cwd = await validateCwd(workdir);
      const shellEnv = buildEnv(env);
      const result = await runWithFallbackShells({
        command: cmd,
        cwd,
        env: shellEnv,
        stdin: stdin as string | undefined,
        timeoutMs,
        maxOutputChars: outputLimit,
      });

      const status = result.exitCode === 0 && !result.timedOut && !result.outputLimited ? 'Exit code: 0' : `Command failed (exit code ${result.exitCode ?? '?'})${result.signal ? ` (signal: ${result.signal})` : ''}`;
      const flags = [
        result.timedOut ? 'TIMEOUT_PROCESS_TREE_KILLED' : undefined,
        result.outputLimited ? 'OUTPUT_LIMIT_PROCESS_TREE_KILLED' : undefined,
      ].filter(Boolean).join(', ');
      const header = [
        `${context}${status}`,
        `Shell: ${result.shell}`,
        `Cwd: ${cwd}`,
        `Duration: ${result.durationMs} ms`,
        flags ? `Flags: ${flags}` : undefined,
      ].filter(Boolean).join('\n');

      return `${header}\n${formatOutput(result.stdout, result.stderr)}`;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      return `${context}Error executing command safely: ${msg}`;
    }
  },
};
