/**
 * Nova Agent — Tool: git
 *
 * Safe, structured, read-only Git operations.
 *
 * Supported actions:
 * - status
 * - diff
 * - log
 * - branch
 * - show
 * - ls-files
 *
 * Destructive and network operations are intentionally not exposed.
 */

import { z } from 'zod';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 40_000;
const MAX_OUTPUT_CHARS = 250_000;
const KILL_GRACE_MS = 1_000;
const MAX_PATHS = 50;

const SAFE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  NO_COLOR: '1',
};

type GitRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimited: boolean;
  durationMs: number;
};

type RepoInfo = {
  cwd: string;
  root: string;
  gitDir: string;
};

type BuiltCommand = {
  label: string;
  args: string[];
};

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

async function validateCwd(workdir: unknown): Promise<string> {
  const cwd = resolve(typeof workdir === 'string' && workdir.trim() ? workdir : process.cwd());
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  return cwd;
}

function validatePathspecs(input: unknown): string[] {
  if (!input) return [];
  if (!Array.isArray(input)) throw new Error('paths must be an array of pathspec strings.');
  if (input.length > MAX_PATHS) throw new Error(`too many paths (max ${MAX_PATHS}).`);
  return input.map((p, idx) => {
    if (typeof p !== 'string' || !p.trim()) throw new Error(`paths[${idx}] must be a non-empty string.`);
    if (p.includes('\0')) throw new Error(`paths[${idx}] contains a NUL byte.`);
    if (p.length > 500) throw new Error(`paths[${idx}] is too long (max 500 chars).`);
    return p;
  });
}

function validateRevision(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string') throw new Error(`${field} must be a string.`);
  const rev = input.trim();
  if (!rev) return undefined;
  if (rev.startsWith('-')) throw new Error(`${field} must not start with '-'.`);
  if (rev.includes('\0') || /\s/.test(rev)) throw new Error(`${field} must not contain whitespace or NUL bytes.`);
  if (!/^[A-Za-z0-9_./~^:@{}+\-=]+$/.test(rev)) throw new Error(`${field} contains unsupported characters.`);
  if (rev.length > 200) throw new Error(`${field} is too long (max 200 chars).`);
  return rev;
}

function gitDisplay(args: string[]): string {
  const quote = (s: string) => /^[A-Za-z0-9_./:+=@{}~^-]+$/.test(s) ? s : JSON.stringify(s);
  return ['git', ...args].map(quote).join(' ');
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

async function runGit(args: string[], cwd: string, timeoutMs: number, maxOutputChars: number): Promise<GitRunResult> {
  const started = Date.now();
  const child = spawn('git', ['-c', 'color.ui=false', '-c', 'core.pager=cat', '-C', cwd, ...args], {
    cwd,
    env: SAFE_ENV,
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
    const remaining = maxOutputChars - totalChars;
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
  child.stdin.end();

  const timer = setTimeout(() => void terminate('timeout'), timeoutMs);

  return await new Promise<GitRunResult>((resolveRun, rejectRun) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    child.once('error', err => settle(() => rejectRun(err)));
    child.once('close', (exitCode, signal) => settle(() => resolveRun({
      stdout,
      stderr,
      exitCode,
      signal,
      timedOut,
      outputLimited,
      durationMs: Date.now() - started,
    })));
  });
}

async function getRepoInfo(cwd: string, timeoutMs: number): Promise<RepoInfo> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--git-dir'], cwd, timeoutMs, 20_000);
  if (result.exitCode !== 0) {
    const details = formatOutput(result.stdout, result.stderr);
    throw new Error(`not a Git work tree: ${cwd}\n${details}`);
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines[0] !== 'true') throw new Error(`not inside a Git work tree: ${cwd}`);
  return { cwd, root: lines[1] || cwd, gitDir: lines[2] || '.git' };
}

function buildCommand(input: any): BuiltCommand {
  const action = input.action as string;
  const paths = validatePathspecs(input.paths);
  const maxCount = clampNumber(input.maxCount, 20, 1, 200);
  const context = clampNumber(input.context, 3, 0, 20);

  switch (action) {
    case 'status':
      return { label: 'status', args: ['status', '--short', '--branch', '--untracked-files=all'] };

    case 'diff': {
      const diffMode = (input.diffMode as string) || 'patch';
      const args = ['diff', '--no-ext-diff', '--no-color'];
      if (input.staged === true) args.push('--cached');
      if (diffMode === 'patch') args.push(`--unified=${context}`);
      else if (diffMode === 'stat') args.push('--stat');
      else if (diffMode === 'name-only') args.push('--name-only');
      const rev = validateRevision(input.revision, 'revision');
      if (rev) args.push(rev);
      if (paths.length > 0) args.push('--', ...paths);
      return { label: 'diff', args };
    }

    case 'log': {
      const rev = validateRevision(input.revision, 'revision');
      const args = ['log', `--max-count=${maxCount}`, '--date=iso-strict', '--decorate=short', '--pretty=format:%h%x09%ad%x09%d%x09%s'];
      if (rev) args.push(rev);
      if (paths.length > 0) args.push('--', ...paths);
      return { label: 'log', args };
    }

    case 'branch': {
      const branchMode = (input.branchMode as string) || 'list';
      if (branchMode === 'current') return { label: 'branch current', args: ['branch', '--show-current'] };
      const args = ['branch', '--list'];
      if (branchMode === 'all') args.push('--all');
      if (input.verbose === true) args.push('--verbose', '--verbose');
      return { label: 'branch', args };
    }

    case 'show': {
      const rev = validateRevision(input.revision || 'HEAD', 'revision') || 'HEAD';
      const args = ['show', '--no-ext-diff', '--no-color', '--stat', '--patch', '--format=fuller', rev];
      if (paths.length > 0) args.push('--', ...paths);
      return { label: 'show', args };
    }

    case 'ls-files': {
      const lsMode = (input.lsMode as string) || 'tracked';
      const args = ['ls-files'];
      if (lsMode === 'stage') args.push('--stage');
      else if (lsMode === 'modified') args.push('--modified');
      else if (lsMode === 'deleted') args.push('--deleted');
      else if (lsMode === 'others') args.push('--others', '--exclude-standard');
      else if (lsMode === 'all') args.push('--cached', '--modified', '--deleted', '--others', '--exclude-standard', '--deduplicate');
      if (paths.length > 0) args.push('--', ...paths);
      return { label: 'ls-files', args };
    }

    default:
      throw new Error(`unsupported git action: ${action}. Allowed actions: status, diff, log, branch, show, ls-files.`);
  }
}

export const gitTool: NovaTool = {
  name: 'git',
  description: 'Run safe read-only Git operations with structured output: status, diff, log, branch, show, ls-files. Validates repo/cwd, enforces timeout/output limits, disables prompts/pagers/colors, and does not expose destructive or network operations.',
  capability: 'git',
  readOnly: true,
  riskLevel: 'low',
  inputSchema: z.object({
    action: z.enum(['status', 'diff', 'log', 'branch', 'show', 'ls-files']).describe('Read-only Git operation to run.'),
    cwd: z.string().optional().describe('Directory inside a Git work tree. Default: current process cwd.'),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe(`Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS}).`),
    maxOutputChars: z.number().int().min(1000).max(MAX_OUTPUT_CHARS).optional().describe(`Combined stdout/stderr cap (default: ${DEFAULT_MAX_OUTPUT_CHARS}, max: ${MAX_OUTPUT_CHARS}).`),
    paths: z.array(z.string()).optional().describe(`Optional pathspec filters passed after -- (max ${MAX_PATHS}).`),
    revision: z.string().optional().describe('Optional safe Git revision/range for diff/log/show. Defaults to HEAD for show. No whitespace, no leading dash.'),
    staged: z.boolean().optional().describe('For diff: show staged changes with --cached.'),
    diffMode: z.enum(['patch', 'stat', 'name-only']).optional().describe('For diff: output mode. Default: patch.'),
    context: z.number().int().min(0).max(20).optional().describe('For diff: unified context lines. Default: 3.'),
    maxCount: z.number().int().min(1).max(200).optional().describe('For log: max commits. Default: 20.'),
    branchMode: z.enum(['current', 'list', 'all']).optional().describe('For branch: current branch, local list, or all local/remotes. Default: list.'),
    verbose: z.boolean().optional().describe('For branch list/all: include verbose upstream/worktree info.'),
    lsMode: z.enum(['tracked', 'modified', 'deleted', 'others', 'stage', 'all']).optional().describe('For ls-files: file category. Default: tracked.'),
  }),
  execute: async (input) => {
    const timeoutMs = clampNumber(input.timeout, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
    const outputLimit = clampNumber(input.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS, 1000, MAX_OUTPUT_CHARS);

    try {
      const cwd = await validateCwd(input.cwd);
      const repo = await getRepoInfo(cwd, timeoutMs);
      const command = buildCommand(input);
      const result = await runGit(command.args, repo.cwd, timeoutMs, outputLimit);
      const ok = result.exitCode === 0 && !result.timedOut && !result.outputLimited;
      const flags = [
        result.timedOut ? 'TIMEOUT_PROCESS_TREE_KILLED' : undefined,
        result.outputLimited ? 'OUTPUT_LIMIT_PROCESS_TREE_KILLED' : undefined,
      ].filter(Boolean).join(', ');
      const header = [
        `## Git ${command.label}`,
        `Command: ${gitDisplay(command.args)}`,
        `Repo root: ${repo.root}`,
        `Cwd: ${repo.cwd}`,
        `Git dir: ${repo.gitDir}`,
        `Exit code: ${result.exitCode ?? '?'}`,
        result.signal ? `Signal: ${result.signal}` : undefined,
        `Duration: ${result.durationMs} ms`,
        flags ? `Flags: ${flags}` : undefined,
      ].filter(Boolean).join('\n');
      const body = formatOutput(result.stdout, result.stderr);
      if (!ok) return `${header}\n\nCommand did not complete cleanly.\n${body}`;
      return `${header}\n\n${body}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error in git tool: ${msg}\nAllowed actions are read-only: status, diff, log, branch, show, ls-files. Destructive/network operations are intentionally unavailable.`;
    }
  },
};
