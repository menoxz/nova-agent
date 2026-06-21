/**
 * Nova Agent — Tool: glob
 *
 * Searches for files matching a glob pattern.
 * Supports exclude patterns, depth limit, and hidden file control.
 *
 * Cas d'usage:
 *   "**\/*.ts"                  → tous les TS récursivement
 *   "src/**\/*.ts"              → TS dans src/
 *   "**\/*.log"                 → tous les logs
 *   exclude: ["node_modules"]   → ignorer node_modules
 *   depth: 2                    → seulement 2 niveaux de profondeur
 */

import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const MAX_RESULTS = 200;

/**
 * Convert a glob file pattern to a RegExp for matching filenames.
 */
function patternToRegex(pattern: string): RegExp {
  const regexStr = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$';
  return new RegExp(regexStr, 'i');
}

/**
 * Check if a relative path contains any of the exclude patterns.
 * Each exclude pattern is checked as a substring match against the relative path.
 */
function isExcluded(relPath: string, excludePatterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  for (const ex of excludePatterns) {
    const exNormalized = ex.replace(/\\/g, '/');
    // If exclude pattern contains *, treat as glob; otherwise substring match
    if (exNormalized.includes('*') || exNormalized.includes('?')) {
      const regex = patternToRegex(exNormalized);
      if (regex.test(normalized) || regex.test(normalized.split('/').pop() || '')) return true;
    } else if (normalized.includes(exNormalized)) {
      return true;
    }
  }
  return false;
}

async function walk(
  dir: string,
  results: string[],
  root: string,
  fileRegex: RegExp,
  recursive: boolean,
  maxResults: number,
  depth: number,
  maxDepth: number,
  excludePatterns: string[],
): Promise<void> {
  if (results.length >= maxResults) return;
  if (depth > maxDepth) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath).replace(/\\/g, '/');

    // Check exclusion
    if (excludePatterns.length > 0 && isExcluded(relPath, excludePatterns)) continue;

    if (entry.isDirectory()) {
      // Skip hidden dirs at root if not explicitly included
      if (depth === 0 && entry.name.startsWith('.')) continue;
      if (recursive) {
        await walk(fullPath, results, root, fileRegex, recursive, maxResults, depth + 1, maxDepth, excludePatterns);
      }
    } else if (entry.isFile()) {
      if (fileRegex.test(entry.name)) {
        results.push(relPath);
      }
    }
  }
}

export const globTool: NovaTool = {
  name: 'glob',
  description: `Search for files matching a glob pattern. Supports * (any chars), ** (recursive), ? (single char). Exclude patterns and depth limit available. Max results: ${MAX_RESULTS}.`,
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "*.json", "src/**/*.ts")'),
    root: z.string().optional().describe('Root directory (default: current working directory)'),
    maxResults: z.number().int().min(1).max(500).optional().describe(`Max results (default: ${MAX_RESULTS})`),
    exclude: z.array(z.string()).optional().describe('Patterns to exclude (e.g. ["node_modules", "dist", "*.log"])'),
    depth: z.number().int().min(1).max(20).optional().describe('Maximum directory depth (default: 10)'),
  }),
  execute: async ({ pattern, root, maxResults, exclude, depth }) => {
    const searchRoot = resolve((root as string) || process.cwd());
    const maxRes = (maxResults as number) || MAX_RESULTS;
    const maxDepth = (depth as number) ?? 10;
    const excludeList = (exclude as string[]) || [];

    try {
      const parts = (pattern as string).replace(/\\/g, '/').split('/');
      const filePattern = parts[parts.length - 1];
      const dirPattern = parts.slice(0, -1).join('/');
      const recursive = dirPattern.includes('**');

      const fileRegex = patternToRegex(filePattern);
      const results: string[] = [];

      const start = Date.now();
      await walk(searchRoot, results, searchRoot, fileRegex, recursive, maxRes, 0, maxDepth, excludeList);
      const elapsed = Date.now() - start;

      if (results.length === 0) {
        const excludeInfo = excludeList.length > 0 ? ` (excluding: ${excludeList.join(', ')})` : '';
        return `No files found matching "${pattern}" in ${searchRoot}${excludeInfo} (searched in ${elapsed}ms).`;
      }

      const lines = results.slice(0, maxRes);
      const summary = results.length >= maxRes
        ? `Found ${results.length}+ files (showing ${maxRes}):`
        : `Found ${results.length} file(s):`;

      const excludeNote = excludeList.length > 0 ? `\nExcluded: ${excludeList.join(', ')}` : '';

      return `${summary}${excludeNote}\n\n${lines.join('\n')}\n\n(searched in ${elapsed}ms)`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching files: ${msg}`;
    }
  },
};
