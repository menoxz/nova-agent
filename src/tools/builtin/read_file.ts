/**
 * Nova Agent — Tool: read_file
 *
 * Reads files in a model-aware way.
 *
 * Text files:
 *   - returns readable text with offset/limit/head/tail.
 * Binary files:
 *   - detects file type and returns metadata.
 * Multimodal files:
 *   - can return image-data/file-data content parts to the LLM when supported.
 *   - images are sent in auto mode when small enough.
 *   - audio/video/generic files require force mode because provider support varies.
 */

import { z } from 'zod';
import { readFile, stat, open } from 'node:fs/promises';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import type { NovaTool } from '../../types.js';

const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_OUTPUT_LENGTH = 100_000;
const BINARY_CHECK_BYTES = 8192;
const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB, conservative multimodal payload limit
const ABSOLUTE_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // hard guardrail

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() || '';
}

function getMediaType(path: string): string {
  const ext = extOf(path);
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    js: 'application/javascript',
    ts: 'application/typescript',
    tsx: 'application/typescript',
    jsx: 'application/javascript',
    html: 'text/html',
    css: 'text/css',
    csv: 'text/csv',
    xml: 'application/xml',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    webm: 'video/webm',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    exe: 'application/x-msdownload',
    dll: 'application/x-msdownload',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  return map[ext] || 'application/octet-stream';
}

function isTextualMedia(mediaType: string): boolean {
  return mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType === 'application/javascript'
    || mediaType === 'application/typescript'
    || mediaType === 'application/xml'
    || mediaType === 'application/x-yaml';
}

function isImageMedia(mediaType: string): boolean {
  return mediaType.startsWith('image/') && mediaType !== 'image/svg+xml';
}

function isAudioMedia(mediaType: string): boolean {
  return mediaType.startsWith('audio/');
}

function isVideoMedia(mediaType: string): boolean {
  return mediaType.startsWith('video/');
}

function isBinaryContent(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  let nonPrintable = 0;
  const len = Math.min(buffer.length, BINARY_CHECK_BYTES);
  for (let i = 0; i < len; i++) {
    const byte = buffer[i];
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintable++;
  }
  return nonPrintable > len * 0.1;
}

async function computeHash(filePath: string): Promise<string> {
  try {
    const crypto = await import('node:crypto');
    const content = await readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return '(unavailable)';
  }
}

function humanSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function hexPreview(filePath: string, size: number): Promise<string> {
  const maxHexBytes = Math.min(size, 512);
  const fd = await open(filePath, 'r');
  const buf = Buffer.alloc(maxHexBytes);
  await fd.read(buf, 0, maxHexBytes, 0);
  await fd.close();

  const hexLines: string[] = [
    `File: ${filePath}`,
    `Size: ${size} bytes`,
    `Hex preview (${maxHexBytes} bytes):\n`,
  ];

  for (let i = 0; i < maxHexBytes; i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }

  return hexLines.join('\n');
}

function multimodalOutput(params: {
  filePath: string;
  filename: string;
  mediaType: string;
  dataBase64: string;
  size: number;
  hash: string;
  kind: 'image' | 'file';
}): ToolResultOutput {
  const { filePath, filename, mediaType, dataBase64, size, hash, kind } = params;
  const intro = [
    `File attached to model: ${filePath}`,
    `Filename: ${filename}`,
    `Media type: ${mediaType}`,
    `Size: ${humanSize(size)} (${size} bytes)`,
    `SHA256: ${hash}`,
    '',
    kind === 'image'
      ? 'The image bytes are attached as image-data. Analyze the visual content directly if your model supports vision.'
      : 'The file bytes are attached as file-data. Analyze it directly if your model/provider supports this media type.',
  ].join('\n');

  return {
    type: 'content',
    value: [
      { type: 'text', text: intro },
      kind === 'image'
        ? { type: 'image-data', data: dataBase64, mediaType }
        : { type: 'file-data', data: dataBase64, mediaType, filename },
    ],
  };
}

export const readFileTool: NovaTool = {
  name: 'read_file',
  description: `Read a file. Text: returns text with full/head/tail/offset/limit. Binary/multimodal: detects images/audio/video/PDF/etc. and can attach supported files to the model with multimodal="auto" or "force". Use multimodal="off" for metadata only.`,
  inputSchema: z.object({
    path: z.string().describe('Absolute or workspace-relative path to the file to read'),
    offset: z.number().int().min(0).optional().describe('Starting line number (0-based). Use with limit.'),
    limit: z.number().int().min(1).optional().describe('Max lines to read from offset.'),
    mode: z.enum(['head', 'tail', 'full', 'hex']).optional()
      .describe('"full" (default), "head", "tail", or "hex" preview.'),
    lines: z.number().int().min(1).max(1000).optional()
      .describe('Number of lines for head/tail mode (default: 20).'),
    multimodal: z.enum(['auto', 'force', 'off']).optional()
      .describe('auto: attach small images to capable models; force: attach image/audio/video/generic file-data; off: metadata only. Default: auto.'),
    maxAttachmentBytes: z.number().int().min(1).max(ABSOLUTE_MAX_ATTACHMENT_BYTES).optional()
      .describe('Max file bytes to attach multimodally. Default: 5MB, hard max: 20MB.'),
  }),
  execute: async ({ path, offset, limit, mode, lines, multimodal, maxAttachmentBytes }) => {
    try {
      const filePath = path as string;
      const readMode = (mode as string) || 'full';
      const multimodalMode = (multimodal as string) || 'auto';
      const lineCount = (lines as number) || 20;
      const attachmentLimit = Math.min(
        (maxAttachmentBytes as number) || DEFAULT_MAX_ATTACHMENT_BYTES,
        ABSOLUTE_MAX_ATTACHMENT_BYTES,
      );

      let fileStat: any;
      try {
        fileStat = await stat(filePath);
      } catch {
        return `Error: file not found at "${filePath}". Use glob or list_directory to find the correct path.`;
      }

      if (!fileStat.isFile()) {
        return `Error: "${filePath}" is not a file (it's a ${fileStat.isDirectory() ? 'directory' : 'special entry'}).`;
      }

      if (fileStat.size === 0) return `File: ${filePath}\nSize: 0 bytes (empty file)`;
      if (readMode === 'hex') return await hexPreview(filePath, fileStat.size);

      const mediaType = getMediaType(filePath);
      const filename = filePath.replace(/.*[\\/]/, '') || 'file';

      // Multimodal handling first for known media. This is the critical improvement.
      const canTryMultimodal = multimodalMode !== 'off'
        && fileStat.size <= attachmentLimit
        && (
          isImageMedia(mediaType)
          || (multimodalMode === 'force' && (isAudioMedia(mediaType) || isVideoMedia(mediaType) || !isTextualMedia(mediaType)))
        );

      if (canTryMultimodal) {
        const data = await readFile(filePath);
        const hash = await computeHash(filePath);
        return multimodalOutput({
          filePath,
          filename,
          mediaType,
          dataBase64: data.toString('base64'),
          size: fileStat.size,
          hash,
          kind: isImageMedia(mediaType) ? 'image' : 'file',
        });
      }

      // Guardrail for large text-ish files.
      if (fileStat.size > MAX_TEXT_FILE_SIZE) {
        return [
          `File: ${filePath}`,
          `Media type: ${mediaType}`,
          `Size: ${humanSize(fileStat.size)} (${fileStat.size} bytes)`,
          '',
          `Error: file exceeds text read limit (${humanSize(MAX_TEXT_FILE_SIZE)}).`,
          `Use mode="hex" for byte preview, or specialized tools for this file type.`,
        ].join('\n');
      }

      const rawBuffer = await readFile(filePath);
      const binary = !isTextualMedia(mediaType) && isBinaryContent(rawBuffer);

      if (binary) {
        const hash = await computeHash(filePath);
        const supportHint = fileStat.size <= attachmentLimit
          ? `Use multimodal="force" to attach this file as file-data if your model/provider supports ${mediaType}.`
          : `File is too large for multimodal attachment limit (${humanSize(attachmentLimit)}).`;

        return [
          `File: ${filePath}`,
          `Media type: ${mediaType}`,
          `Size: ${humanSize(fileStat.size)} (${fileStat.size} bytes)`,
          `SHA256: ${hash}`,
          '',
          `⚠️ This file appears to be binary and was not displayed as text.`,
          supportHint,
          `Use mode="hex" for a hexadecimal preview.`,
        ].join('\n');
      }

      // Text file path.
      const content = rawBuffer.toString('utf-8');
      const textLines = content.split('\n');
      const totalLines = textLines.length;
      let selectedLines: string[];

      if (readMode === 'head') selectedLines = textLines.slice(0, lineCount);
      else if (readMode === 'tail') selectedLines = textLines.slice(Math.max(0, totalLines - lineCount));
      else {
        const startOffset = (offset as number) ?? 0;
        const lineLimit = (limit as number) ?? totalLines;
        selectedLines = textLines.slice(startOffset, startOffset + lineLimit);
      }

      let result = selectedLines.join('\n');
      if (result.length > MAX_OUTPUT_LENGTH) result = result.slice(0, MAX_OUTPUT_LENGTH) + '\n...(truncated)';

      const header = `File: ${filePath}\nMedia type: ${mediaType}\nSize: ${fileStat.size} bytes | Lines: ${totalLines}`;
      const range = readMode === 'head'
        ? ` (showing first ${lineCount} lines)`
        : readMode === 'tail'
        ? ` (showing last ${lineCount} lines)`
        : (limit && (limit as number) < totalLines)
        ? ` (showing lines ${String(offset ?? 0)}-${String((offset ?? 0) + selectedLines.length - 1)})`
        : '';

      return `${header}${range}\n\n${result}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${msg}`;
    }
  },
};
