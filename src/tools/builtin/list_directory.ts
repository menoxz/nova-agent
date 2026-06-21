/**
 * Nova Agent — Tool: list_directory
 *
 * Lists the contents of a directory or recursively walks subdirectories.
 * Shows file sizes, types, modification dates. Can compute totals.
 *
 * Cas d'usage:
 *   - Simple listing: ls -la like
 *   - Recursive: tree-like output
 *   - Summary: total file count and size
 *   - Sort by name, size, or date
 */

import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const MAX_ENTRIES = 500;

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(d: Date): string {
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (isThisYear) {
    return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Entry {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  mtime: Date;
  depth: number;
}

async function collectEntries(
  dirPath: string,
  depth: number,
  maxDepth: number,
  showHidden: boolean,
  results: Entry[],
  maxEntries: number,
): Promise<void> {
  if (depth > maxDepth || results.length >= maxEntries) return;

  let names: string[];
  try {
    names = await readdir(dirPath);
  } catch {
    return;
  }

  for (const name of names) {
    if (results.length >= maxEntries) break;
    if (!showHidden && name.startsWith('.')) continue;

    const fullPath = join(dirPath, name);
    try {
      const s = await stat(fullPath);
      results.push({
        name: depth > 0 ? name : name,
        fullPath,
        isDir: s.isDirectory(),
        size: s.size,
        mtime: s.mtime,
        depth,
      });

      if (s.isDirectory() && depth < maxDepth) {
        await collectEntries(fullPath, depth + 1, maxDepth, showHidden, results, maxEntries);
      }
    } catch {
      // Skip unreadable entries
    }
  }
}

export const listDirectoryTool: NovaTool = {
  name: 'list_directory',
  description: `List directory contents with file sizes, types, and dates. Supports recursive mode (up to 5 levels) and summary mode for totals. Max ${MAX_ENTRIES} entries.`,
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the directory'),
    showHidden: z.boolean().optional().describe('Show hidden files (default: false)'),
    sortBy: z.enum(['name', 'size', 'date']).optional().describe('Sort: name (default), size, or date'),
    recursive: z.boolean().optional().describe('Recursively list subdirectories (default: false)'),
    depth: z.number().int().min(1).max(5).optional().describe('Recursion depth (default: 1, max: 5). Requires recursive: true'),
    summary: z.boolean().optional().describe('Show only totals (file count, total size) without listing (default: false)'),
  }),
  execute: async ({ path, showHidden, sortBy, recursive, depth, summary }) => {
    const dirPath = resolve(path as string);
    const showDotFiles = showHidden === true;
    const sort = (sortBy as string) || 'name';
    const isRecursive = recursive === true;
    const maxDepth = isRecursive ? (depth as number) ?? 3 : 0;
    const isSummary = summary === true;

    // Verify directory
    try {
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) {
        return `Error: "${dirPath}" is not a directory.`;
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') return `Error: directory not found: "${dirPath}"`;
      return `Error: ${err.message}`;
    }

    // Collect entries
    const entries: Entry[] = [];
    await collectEntries(dirPath, 0, maxDepth, showDotFiles, entries, MAX_ENTRIES);

    // Summary mode
    if (isSummary) {
      const dirCount = entries.filter(e => e.isDir).length;
      const fileCount = entries.filter(e => !e.isDir).length;
      const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
      const largest = entries.filter(e => !e.isDir).sort((a, b) => b.size - a.size).slice(0, 5);

      let result = `Summary: ${dirPath}\n`;
      result += `  Directories: ${dirCount}\n`;
      result += `  Files: ${fileCount}\n`;
      result += `  Total size: ${formatSize(totalSize)} (${totalSize} bytes)\n`;

      if (largest.length > 0) {
        result += `\nLargest files:\n`;
        for (const f of largest) {
          const short = f.fullPath.replace(dirPath + '\\', '');
          result += `  ${formatSize(f.size).padStart(8)}  ${short}\n`;
        }
      }
      return result;
    }

    // Sort
    entries.sort((a, b) => {
      // Directories first
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;

      if (sort === 'size') return b.size - a.size;
      if (sort === 'date') return b.mtime.getTime() - a.mtime.getTime();
      return a.name.localeCompare(b.name);
    });

    // Format output
    const truncated = entries.length > MAX_ENTRIES;
    const display = entries.slice(0, MAX_ENTRIES);

    const lines: string[] = [`Directory: ${dirPath}\n`];
    const treeMode = isRecursive;

    if (treeMode) {
      // Tree-like output
      lines.push(`${'Type'.padEnd(5)} ${'Size'.padEnd(8)} ${'Modified'.padEnd(14)} Path`);
      lines.push(`${'─'.repeat(4)}  ${'─'.repeat(7)}  ${'─'.repeat(13)}  ────`);
      for (const entry of display) {
        const type = entry.isDir ? '[DIR]' : '[FILE]';
        const size = entry.isDir ? '—' : formatSize(entry.size);
        const date = formatDate(entry.mtime);
        const indent = '  '.repeat(entry.depth);
        const name = entry.isDir ? `${entry.name}/` : entry.name;
        const displayPath = entry.depth === 0 ? entry.name : join('...', entry.name.replace(/.*[\\/]/, ''));

        lines.push(`${type.padEnd(5)} ${size.padEnd(8)} ${date.padEnd(14)} ${indent}${name}`);
      }
    } else {
      // Standard flat listing
      lines.push(`${'Type'.padEnd(5)} ${'Size'.padEnd(8)} ${'Modified'.padEnd(14)} Name`);
      lines.push(`${'─'.repeat(4)}  ${'─'.repeat(7)}  ${'─'.repeat(13)}  ────`);
      for (const entry of display) {
        const type = entry.isDir ? '[DIR]' : '[FILE]';
        const size = entry.isDir ? '—' : formatSize(entry.size);
        const date = formatDate(entry.mtime);
        const name = entry.isDir ? `${entry.name}/` : entry.name;
        lines.push(`${type.padEnd(5)} ${size.padEnd(8)} ${date.padEnd(14)} ${name}`);
      }
    }

    if (truncated) {
      lines.push(`\n... and ${entries.length - MAX_ENTRIES} more (showing ${MAX_ENTRIES}/${entries.length})`);
    }

    const dirCount = entries.filter(e => e.isDir).length;
    const fileCount = entries.filter(e => !e.isDir).length;
    lines.push(`\n${dirCount} directories, ${fileCount} files`);
    if (isRecursive) {
      const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
      lines.push(`Total size: ${formatSize(totalSize)}`);
    }

    return lines.join('\n');
  },
};
