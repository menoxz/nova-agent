/**
 * Nova Agent — Tool: write_file
 *
 * Writes content to a file with safety features:
 *   - dry-run: preview what would be written without touching disk
 *   - diff: show a unified diff when overwriting
 *   - atomic: write to temp file then rename (prevents partial writes)
 *   - backup: create .bak before overwriting
 *   - append: add to end of file
 *
 * ⚠️ Write mode overwrites existing files.
 */

import { z } from 'zod';
import { writeFile, appendFile, mkdir, copyFile, stat, rename, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NovaTool } from '../../types.js';

const MAX_DIFF_SIZE = 1024 * 1024; // 1 MB — don't diff larger files

/**
 * Generate a simple unified diff between old and new content.
 */
function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLines = 100; // Prevent huge diffs

  const diffLines: string[] = [
    `--- ${filePath}`,
    `+++ ${filePath} (proposed)`,
    `@@ -1,${Math.min(oldLines.length, maxLines)} +1,${Math.min(newLines.length, maxLines)} @@`,
  ];

  let line = 0;
  while (line < Math.min(oldLines.length, newLines.length, maxLines)) {
    if (oldLines[line] !== newLines[line]) {
      diffLines.push(`-${oldLines[line]}`);
      diffLines.push(`+${newLines[line]}`);
    } else {
      diffLines.push(` ${oldLines[line]}`);
    }
    line++;
  }

  // Remaining old lines
  while (line < Math.min(oldLines.length, maxLines)) {
    diffLines.push(`-${oldLines[line]}`);
    line++;
  }

  // Remaining new lines
  while (line < Math.min(newLines.length, maxLines)) {
    diffLines.push(`+${newLines[line]}`);
    line++;
  }

  if (oldLines.length > maxLines || newLines.length > maxLines) {
    diffLines.push('...(diff truncated)');
  }

  return diffLines.join('\n');
}

export const writeFileTool: NovaTool = {
  name: 'write_file',
  description: 'Write or append content to a file. Features: dry-run preview, diff against existing, atomic writes, backup creation. Use with caution — this modifies the filesystem.',
  capability: 'write',
  readOnly: false,
  riskLevel: 'high',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file to write'),
    content: z.string().describe('Content to write to the file'),
    mode: z.enum(['write', 'append']).optional().describe('"write" (default, overwrites) or "append" (adds to end)'),
    backup: z.boolean().optional().describe('If true and file exists, creates a .bak backup before overwriting'),
    dryRun: z.boolean().optional().describe('If true, only preview the change without modifying the file'),
    atomic: z.boolean().optional().describe('If true, write to temp file then rename atomically (prevents partial writes)'),
  }),
  execute: async ({ path, content, mode, backup, dryRun, atomic }) => {
    try {
      const filePath = resolve(path as string);
      const fileContent = content as string;
      const writeMode = (mode as string) || 'write';
      const isDryRun = dryRun === true;
      const isAtomic = atomic === true && writeMode !== 'append';

      // Ensure parent directory exists (unless dry-run)
      if (!isDryRun) {
        const dir = dirname(filePath);
        await mkdir(dir, { recursive: true });
      }

      // Check if file exists
      const exists = await stat(filePath).then(() => true).catch(() => false);

      if (isDryRun) {
        // Dry-run mode: show what would happen
        const lines: string[] = [];
        lines.push(`[DRY-RUN] Would ${writeMode} to: ${filePath}`);
        lines.push(`Size: ${fileContent.length} bytes | File exists: ${exists}`);

        if (exists && writeMode === 'write') {
          // Read existing content for diff
          try {
            const oldContent = await readFile(filePath, 'utf-8');
            if (oldContent.length < MAX_DIFF_SIZE) {
              lines.push('');
              lines.push(generateDiff(oldContent, fileContent, filePath));
            } else {
              lines.push('(existing file is too large to diff)');
            }
          } catch {
            lines.push('(unable to read existing file for diff)');
          }
        }

        lines.push(isAtomic ? '\nAtomic write: yes' : '');

        if (backup && exists && writeMode === 'write') {
          lines.push('Backup: would create .bak file');
        }

        return lines.filter(l => l !== '').join('\n');
      }

      if (writeMode === 'append') {
        // Append mode
        await appendFile(filePath, fileContent, 'utf-8');
        const fileStat = await stat(filePath).catch(() => null);
        return `Appended ${fileContent.length} bytes to ${filePath} (total: ${fileStat?.size ?? '?'} bytes)`;
      }

      // Write mode — backup if requested
      if (exists && backup) {
        const backupPath = filePath + '.bak';
        await copyFile(filePath, backupPath);
      }

      // Write content
      if (isAtomic) {
        // Atomic write: write to temp file, then rename
        const tmpPath = join(tmpdir(), `.nova-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await writeFile(tmpPath, fileContent, 'utf-8');
        await rename(tmpPath, filePath);
      } else {
        await writeFile(filePath, fileContent, 'utf-8');
      }

      const action = exists ? 'Overwritten' : 'Created';
      const notes: string[] = [];
      if (exists && backup) notes.push('backup saved');
      if (isAtomic) notes.push('atomic write');
      const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';

      return `${action}: ${filePath} (${fileContent.length} bytes)${noteStr}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error writing file: ${msg}`;
    }
  },
};
