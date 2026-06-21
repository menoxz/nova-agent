/**
 * Nova Agent — Tool: get_file_info
 *
 * Retrieves detailed metadata about one or more files/directories:
 * size, type, timestamps, MIME type, SHA256 hash, extension, blocks.
 *
 * Cas d'usage:
 *   - Un seul fichier → metadata complet
 *   - Plusieurs chemins → comparaison rapide
 *   - Hash computation → vérifier intégrité, détecter doublons
 *   - MIME type → savoir comment traiter le fichier
 */

import { z } from 'zod';
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { NovaTool } from '../../types.js';

const MAX_HASH_SIZE = 500 * 1024 * 1024; // 500 MB — refuse hash beyond this

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatDate(d: Date): string {
  if (d.getTime() === 0) return '(unknown)';
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'tsx': 'application/typescript',
    'jsx': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
    'md': 'text/markdown',
    'yml': 'application/yaml',
    'yaml': 'application/yaml',
    'toml': 'application/toml',
    'env': 'text/plain',
    'sh': 'application/x-sh',
    'bat': 'application/x-bat',
    'ps1': 'application/x-powershell',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'gz': 'application/gzip',
    'tar': 'application/x-tar',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    'exe': 'application/x-msdownload',
    'dll': 'application/x-msdownload',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'csv': 'text/csv',
    'log': 'text/plain',
    'py': 'text/x-python',
    'rs': 'text/x-rust',
    'go': 'text/x-go',
    'sql': 'text/x-sql',
    'lock': 'application/json',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

async function computeHash(filePath: string, size: number): Promise<string> {
  if (size > MAX_HASH_SIZE) return '(too large)';
  if (size === 0) return '(empty)';
  try {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return '(unavailable)';
  }
}

async function infoForPath(filePath: string, computeHashFlag: boolean): Promise<string> {
  const resolved = resolve(filePath);
  let stats;
  try {
    stats = await stat(resolved);
  } catch (err: any) {
    if (err.code === 'ENOENT') return `Path not found: ${resolved}`;
    return `Error: ${err.message}`;
  }

  const lines: string[] = [];
  lines.push(`Path: ${resolved}`);
  lines.push(`Type: ${stats.isDirectory() ? '📁 Directory' : stats.isFile() ? '📄 File' : stats.isSymbolicLink() ? '🔗 Symbolic Link' : '⚙️ Special'}`);
  lines.push(`Size: ${formatSize(stats.size)} (${stats.size} bytes)`);

  if (stats.isFile()) {
    const mime = guessMimeType(resolved);
    lines.push(`MIME: ${mime}`);
    const ext = resolved.includes('.') ? resolved.split('.').pop() : '(none)';
    lines.push(`Extension: .${ext}`);
  }

  lines.push(`Created:  ${formatDate(stats.birthtime)}`);
  lines.push(`Modified: ${formatDate(stats.mtime)}`);
  lines.push(`Accessed: ${formatDate(stats.atime)}`);

  if (stats.isFile()) {
    lines.push(`Blocks: ${stats.blocks || '—'}`);
  }

  if (computeHashFlag && stats.isFile()) {
    const hash = await computeHash(resolved, stats.size);
    lines.push(`SHA256: ${hash}`);
  }

  return lines.join('\n');
}

export const getFileInfoTool: NovaTool = {
  name: 'get_file_info',
  description: 'Get detailed metadata about files/directories: size, type, MIME, timestamps, SHA256 hash. Accepts one or multiple paths (comma-separated).',
  inputSchema: z.object({
    path: z.string().describe('File or directory path. For multiple items, use comma separation: "file1.ts, file2.ts"'),
    hash: z.boolean().optional().describe('Compute SHA256 hash (default: false, can be slow for large files)'),
  }),
  execute: async ({ path, hash }) => {
    const computeHashFlag = hash === true;
    const paths = (path as string).split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (paths.length === 0) {
      return 'Error: no path provided.';
    }

    try {
      if (paths.length === 1) {
        return await infoForPath(paths[0], computeHashFlag);
      }

      // Multiple paths
      const results: string[] = [`Metadata for ${paths.length} paths:\n`];
      for (const p of paths) {
        const info = await infoForPath(p, computeHashFlag);
        results.push(info + '\n');
      }
      return results.join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  },
};
