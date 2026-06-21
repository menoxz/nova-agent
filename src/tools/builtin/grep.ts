/**
 * Nova Agent — Tool: grep
 *
 * Searches for text patterns in files using regular expressions.
 *
 * Cas d'usage améliorés:
 *   - Context lines: see N lines before/after each match
 *   - Inverse: find lines that do NOT match the pattern
 *   - Count: count matches without showing content
 *   - Binary skip: auto-detect and skip binary files
 *   - Case-insensitive flag
 *   - Performance: readline streaming, file size limits
 */

import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { NovaTool } from '../../types.js';

const MAX_RESULTS = 100;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const BINARY_CHECK_BYTES = 4096;

interface Match {
  file: string;
  line: number;
  content: string;
}

/**
 * Quick binary detection by reading first bytes of a file.
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const fd = await import('node:fs/promises').then(m => m.open(filePath, 'r'));
    try {
      const buf = Buffer.alloc(BINARY_CHECK_BYTES);
      const { bytesRead } = await fd.read(buf, 0, BINARY_CHECK_BYTES, 0);
      if (bytesRead === 0) return false;

      let nonPrintable = 0;
      for (let i = 0; i < bytesRead; i++) {
        const byte = buf[i];
        if (byte === 0) return true; // Null byte = definitely binary
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintable++;
      }
      return nonPrintable > bytesRead * 0.1;
    } finally {
      await fd.close();
    }
  } catch {
    return true; // Assume binary on error to be safe
  }
}

/**
 * Search a single file for matches with optional context.
 */
async function searchInFile(
  filePath: string,
  regex: RegExp,
  maxResults: number,
  before?: number,
  after?: number,
  invert?: boolean,
  countOnly?: boolean,
): Promise<Match[]> {
  const matches: Match[] = [];

  try {
    const binary = await isBinaryFile(filePath);
    if (binary) return matches; // Skip binary files silently

    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > MAX_FILE_SIZE || fileStat.size === 0) return [];
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    let lineNum = 0;
    const lines: string[] = [];
    let matchedLines = 0;
    let pendingBefore = 0;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineNum++;
      if (countOnly && lineNum % 100 === 0) {
        // In count mode, we just need to know if pattern matches or not
        if (invert ? !regex.test(line) : regex.test(line)) {
          matchedLines++;
        }
        return;
      }
      if (matches.length >= maxResults) return;

      const isMatch = invert ? !regex.test(line) : regex.test(line);

      if (isMatch) {
        matchedLines++;
        lines.push(line);
        pendingBefore = (after ?? 0);
      } else if (pendingBefore > 0 && before !== undefined) {
        lines.push(line);
        pendingBefore--;
      }
    });

    rl.on('close', () => {
      if (countOnly) {
        // Return a special format for count
        resolve([{ file: filePath, line: 0, content: `[count: ${matchedLines}]` }]);
      } else {
        // Build matches with context
        let matchIdx = 0;
        for (const line of lines) {
          // Only add as actual match if it matched (context lines are informational)
          const actualMatch = invert ? !regex.test(lines[matchIdx]) : regex.test(lines[matchIdx]);
          // For context output, we add all lines including context
          if (matches.length < maxResults) {
            matches.push({ file: filePath, line: lineNum - lines.length + matchIdx + 1, content: line });
          }
          matchIdx++;
        }
        resolve(matches);
      }
    });
    rl.on('error', () => resolve(matches));
  });
}

async function walkAndSearch(
  dir: string,
  regex: RegExp,
  maxResults: number,
  depth: number,
  includePattern?: string,
  before?: number,
  after?: number,
  invert?: boolean,
  countOnly?: boolean,
): Promise<Match[]> {
  if (depth > 8) return [];
  const matches: Match[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (matches.length >= maxResults && !countOnly) break;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subMatches = await walkAndSearch(fullPath, regex, maxResults - matches.length, depth + 1, includePattern, before, after, invert, countOnly);
      matches.push(...subMatches);
    } else if (entry.isFile()) {
      if (includePattern && !entry.name.endsWith(includePattern.replace('*.', '.'))) continue;
      const fileMatches = await searchInFile(fullPath, regex, maxResults - matches.length, before, after, invert, countOnly);
      matches.push(...fileMatches);
    }
  }

  return matches;
}

export const grepTool: NovaTool = {
  name: 'grep',
  description: `Search for text patterns in files using regex. Supports: context lines (before/after), inverse match (find non-matching lines), count mode, file type filtering, case-insensitive search. Binary files are auto-skipped.`,
  inputSchema: z.object({
    pattern: z.string().describe('Regular expression (e.g. "function\\s+\\w+", "TODO", "Error|Warning")'),
    root: z.string().optional().describe('Root directory (default: current)'),
    include: z.string().optional().describe('File pattern filter (e.g. "*.ts", "*.js")'),
    ignoreCase: z.boolean().optional().describe('Case-insensitive search (default: false)'),
    maxResults: z.number().int().min(1).max(500).optional().describe(`Max results (default: ${MAX_RESULTS})`),
    beforeContext: z.number().int().min(0).max(20).optional().describe('Lines of context BEFORE each match (default: 0)'),
    afterContext: z.number().int().min(0).max(20).optional().describe('Lines of context AFTER each match (default: 0)'),
    invertMatch: z.boolean().optional().describe('Show lines that do NOT match the pattern (default: false)'),
    count: z.boolean().optional().describe('Only show match counts per file (default: false)'),
  }),
  execute: async ({ pattern, root, include, ignoreCase, maxResults, beforeContext, afterContext, invertMatch, count: countParam }) => {
    const searchRoot = resolve((root as string) || process.cwd());
    const maxRes = (maxResults as number) || MAX_RESULTS;

    try {
      // Build regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern as string, ignoreCase ? 'gi' : 'g');
      } catch {
        return `Error: invalid regex pattern "${pattern}". Use valid JavaScript regex syntax.`;
      }

      const isCountMode = countParam === true;
      const isInvert = invertMatch === true;
      const before = beforeContext as number | undefined;
      const after = afterContext as number | undefined;

      const start = Date.now();
      const matches = await walkAndSearch(
        searchRoot, regex, maxRes, 0,
        include as string | undefined,
        before, after, isInvert, isCountMode,
      );
      const elapsed = Date.now() - start;

      // Convert count-mode results
      if (isCountMode) {
        const fileCounts = new Map<string, number>();
        for (const m of matches) {
          const match = m.content.match(/\[count: (\d+)\]/);
          if (match) {
            fileCounts.set(m.file, parseInt(match[1]));
          }
        }

        if (fileCounts.size === 0) {
          return `No matches found for "${pattern}" in ${searchRoot} (searched in ${elapsed}ms).`;
        }

        let result = `Count results for "${pattern}":\n`;
        let total = 0;
        for (const [file, count] of fileCounts) {
          const shortFile = file.startsWith(searchRoot) ? file.slice(searchRoot.length + 1) : file;
          result += `  ${shortFile}: ${count} line(s)\n`;
          total += count;
        }
        result += `\nTotal: ${total} matching line(s) in ${fileCounts.size} file(s) (${elapsed}ms)`;
        return result;
      }

      if (matches.length === 0) {
        return `No ${isInvert ? 'non-' : ''}matching lines found for "${pattern}" in ${searchRoot} (searched in ${elapsed}ms).`;
      }

      // Group by file
      const grouped = new Map<string, Match[]>();
      for (const m of matches) {
        if (!grouped.has(m.file)) grouped.set(m.file, []);
        grouped.get(m.file)!.push(m);
      }

      const truncated = matches.length >= maxRes;
      let result = truncated
        ? `Found ${matches.length}+ matches (showing ${maxRes}):\n`
        : `Found ${matches.length} match(es):\n`;

      let count = 0;
      for (const [file, fileMatches] of grouped) {
        if (count >= maxRes) break;
        const shortFile = file.startsWith(searchRoot) ? file.slice(searchRoot.length + 1) : file;
        result += `\n${shortFile}:\n`;
        for (const m of fileMatches) {
          if (count >= maxRes) break;
          if (m.line > 0) {
            result += `  ${m.line}: ${m.content}\n`;
          } else {
            result += `  ${m.content}\n`;
          }
          count++;
        }
      }

      result += `\n(${elapsed}ms)`;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching content: ${msg}`;
    }
  },
};
