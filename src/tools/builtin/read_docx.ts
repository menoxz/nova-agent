/**
 * Nova Agent — Tool: read_docx
 *
 * High-completeness DOCX reader based on raw OOXML inspection.
 * A .docx file is a ZIP containing XML parts.
 *
 * Capabilities:
 * - metadata (docProps/core.xml, docProps/app.xml)
 * - structured text: paragraphs + heading detection by paragraph style
 * - tables
 * - headers / footers
 * - comments
 * - images/media detection
 * - text search with snippets
 *
 * Limits:
 * - DOC only is not supported; convert .doc to .docx first.
 * - Text boxes, footnotes/endnotes/tracked changes are best-effort/future improvements.
 */

import { z } from 'zod';
import JSZip from 'jszip';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const MAX_DOCX_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_BLOCKS = 200;
const DEFAULT_MAX_CHARS = 120_000;
const MAX_SEARCH_RESULTS = 100;

type Block = {
  type: 'heading' | 'paragraph';
  text: string;
  style?: string;
  level?: number;
};

type Table = string[][];

type Comment = {
  id?: string;
  author?: string;
  date?: string;
  text: string;
};

type MediaInfo = {
  path: string;
  filename: string;
  mediaType: string;
  size: number;
};

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function localTagRegex(tag: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escaped}>`, 'gi');
}

function attr(xml: string, attrName: string): string | undefined {
  const escaped = attrName.replace(':', ':?');
  const re = new RegExp(`\\b(?:[^:=>\\s]+:)?${escaped.split(':').pop()}=["']([^"']+)["']`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : undefined;
}

function extractTextFromXml(xml: string): string {
  const parts: string[] = [];
  const textRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:delText\b[^>]*>([\s\S]*?)<\/w:delText>|<w:tab\s*\/>|<w:br\s*\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(xml))) {
    if (m[1] !== undefined) parts.push(decodeXml(m[1]));
    else if (m[2] !== undefined) parts.push(decodeXml(m[2]));
    else if (m[0].startsWith('<w:tab')) parts.push('\t');
    else parts.push('\n');
  }
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function extractParagraphStyle(pXml: string): string | undefined {
  const pStyle = pXml.match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["'][^>]*\/>/i)
    || pXml.match(/<w:pStyle\b[^>]*val=["']([^"']+)["'][^>]*\/>/i);
  return pStyle ? decodeXml(pStyle[1]) : undefined;
}

function styleToHeadingLevel(style?: string): number | undefined {
  if (!style) return undefined;
  const compact = style.replace(/\s+/g, '').toLowerCase();
  const m = compact.match(/^heading([1-9])$/) || compact.match(/^titre([1-9])$/);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

function extractParagraphs(documentXml: string, maxBlocks: number): Block[] {
  const blocks: Block[] = [];
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(documentXml)) && blocks.length < maxBlocks) {
    const pXml = m[0];
    const text = extractTextFromXml(pXml);
    if (!text) continue;
    const style = extractParagraphStyle(pXml);
    const level = styleToHeadingLevel(style);
    blocks.push({
      type: level ? 'heading' : 'paragraph',
      text,
      style,
      level,
    });
  }
  return blocks;
}

function extractTables(documentXml: string, maxTables: number, maxRows: number, maxCells: number): Table[] {
  const tables: Table[] = [];
  const tblRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/gi;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tblRe.exec(documentXml)) && tables.length < maxTables) {
    const rows: string[][] = [];
    const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = trRe.exec(tblMatch[0])) && rows.length < maxRows) {
      const cells: string[] = [];
      const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = tcRe.exec(rowMatch[0])) && cells.length < maxCells) {
        cells.push(extractTextFromXml(cellMatch[0]).replace(/\n/g, ' / '));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

async function zipText(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  if (!file) return undefined;
  return await file.async('string');
}

function metadataFromXml(xml: string | undefined): Record<string, string> {
  if (!xml) return {};
  const result: Record<string, string> = {};
  const tags = ['title', 'subject', 'creator', 'keywords', 'description', 'lastModifiedBy', 'revision', 'created', 'modified', 'category', 'contentStatus', 'version', 'Pages', 'Words', 'Characters', 'Application', 'DocSecurity', 'Lines', 'Paragraphs', 'Company', 'Template'];
  for (const tag of tags) {
    const re = localTagRegex(tag);
    const m = re.exec(xml);
    if (m?.[1]) result[tag] = decodeXml(m[1]).trim();
  }
  return result;
}

async function extractHeaderFooter(zip: JSZip, prefix: 'header' | 'footer'): Promise<Array<{ file: string; text: string }>> {
  const entries: Array<{ file: string; text: string }> = [];
  const files = Object.keys(zip.files)
    .filter(p => p.startsWith(`word/${prefix}`) && p.endsWith('.xml'))
    .sort();
  for (const path of files) {
    const xml = await zip.file(path)!.async('string');
    const text = extractTextFromXml(xml);
    if (text) entries.push({ file: path, text });
  }
  return entries;
}

async function extractComments(zip: JSZip): Promise<Comment[]> {
  const xml = await zipText(zip, 'word/comments.xml');
  if (!xml) return [];
  const comments: Comment[] = [];
  const re = /<w:comment\b[\s\S]*?<\/w:comment>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const cXml = m[0];
    comments.push({
      id: attr(cXml, 'id'),
      author: attr(cXml, 'author'),
      date: attr(cXml, 'date'),
      text: extractTextFromXml(cXml),
    });
  }
  return comments;
}

function mediaTypeFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    emf: 'image/x-emf', wmf: 'image/x-wmf',
    mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
  };
  return map[ext] || 'application/octet-stream';
}

async function extractMedia(zip: JSZip): Promise<MediaInfo[]> {
  const media: MediaInfo[] = [];
  const files = Object.keys(zip.files).filter(p => p.startsWith('word/media/') && !zip.files[p].dir).sort();
  for (const path of files) {
    const bytes = await zip.file(path)!.async('uint8array');
    const filename = path.split('/').pop() || path;
    media.push({ path, filename, mediaType: mediaTypeFromFilename(filename), size: bytes.byteLength });
  }
  return media;
}

function formatBlocks(blocks: Block[]): string {
  const lines: string[] = ['## Structured Text'];
  if (blocks.length === 0) return '## Structured Text\n(no text found)';
  for (const [i, block] of blocks.entries()) {
    if (block.type === 'heading') lines.push(`\n${'#'.repeat(Math.min(6, (block.level ?? 1) + 1))} ${block.text}`);
    else lines.push(`${i + 1}. ${block.text}`);
  }
  return lines.join('\n');
}

function formatTables(tables: Table[]): string {
  const lines: string[] = ['## Tables'];
  if (tables.length === 0) return '## Tables\n(none)';
  tables.forEach((table, idx) => {
    lines.push(`\n### Table ${idx + 1} (${table.length} row(s))`);
    table.forEach((row, r) => lines.push(`${r + 1}: ${row.map(c => c || '').join(' | ')}`));
  });
  return lines.join('\n');
}

function formatComments(comments: Comment[]): string {
  const lines: string[] = ['## Comments'];
  if (comments.length === 0) return '## Comments\n(none)';
  comments.forEach((c, idx) => {
    lines.push(`\n### Comment ${idx + 1}${c.id ? ` (id ${c.id})` : ''}`);
    if (c.author) lines.push(`Author: ${c.author}`);
    if (c.date) lines.push(`Date: ${c.date}`);
    lines.push(c.text || '(empty)');
  });
  return lines.join('\n');
}

function formatHeaderFooter(label: string, entries: Array<{ file: string; text: string }>): string {
  const lines: string[] = [`## ${label}`];
  if (entries.length === 0) return `## ${label}\n(none)`;
  for (const entry of entries) {
    lines.push(`\n### ${entry.file}`);
    lines.push(entry.text);
  }
  return lines.join('\n');
}

function formatMedia(media: MediaInfo[]): string {
  const lines: string[] = ['## Media'];
  if (media.length === 0) return '## Media\n(none)';
  for (const item of media) {
    lines.push(`- ${item.path} | ${item.mediaType} | ${item.size} bytes`);
  }
  return lines.join('\n');
}

function searchAll(sections: Array<{ source: string; text: string }>, query: string, caseSensitive: boolean): string {
  const lines: string[] = [`## Search: ${query}`];
  const needle = caseSensitive ? query : query.toLowerCase();
  let total = 0;
  for (const section of sections) {
    const haystack = caseSensitive ? section.text : section.text.toLowerCase();
    let pos = 0;
    let local = 0;
    while (total < MAX_SEARCH_RESULTS) {
      const found = haystack.indexOf(needle, pos);
      if (found === -1) break;
      if (local === 0) lines.push(`\n### ${section.source}`);
      const start = Math.max(0, found - 80);
      const end = Math.min(section.text.length, found + query.length + 120);
      lines.push(`${local + 1}. ...${section.text.slice(start, end).replace(/\s+/g, ' ').trim()}...`);
      total++;
      local++;
      pos = found + Math.max(1, needle.length);
    }
  }
  lines.push(`\nTotal matches: ${total}`);
  return lines.join('\n');
}

export const readDocxTool: NovaTool = {
  name: 'read_docx',
  description: 'Read and inspect Word DOCX files: metadata, structured text/headings, tables, headers/footers, comments, media/images, and text search. DOC legacy files are not supported.',
  inputSchema: z.object({
    path: z.string().describe('Absolute or workspace-relative path to the .docx file'),
    mode: z.enum(['metadata', 'text', 'tables', 'headers', 'comments', 'media', 'search', 'all']).optional()
      .describe('Operation mode. Default: text.'),
    query: z.string().optional().describe('Search query. Required for mode="search".'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default: false).'),
    maxBlocks: z.number().int().min(1).max(2000).optional().describe(`Max paragraphs/headings to extract (default: ${DEFAULT_MAX_BLOCKS}).`),
    maxChars: z.number().int().min(1000).max(500_000).optional().describe(`Max output chars (default: ${DEFAULT_MAX_CHARS}).`),
    maxTables: z.number().int().min(1).max(100).optional().describe('Max tables to extract (default: 20).'),
    maxRows: z.number().int().min(1).max(500).optional().describe('Max rows per table (default: 100).'),
    maxCells: z.number().int().min(1).max(100).optional().describe('Max cells per row (default: 30).'),
  }),
  execute: async ({ path, mode, query, caseSensitive, maxBlocks, maxChars, maxTables, maxRows, maxCells }) => {
    const filePath = resolve(path as string);
    const readMode = (mode as string) || 'text';
    const outputMaxChars = (maxChars as number) || DEFAULT_MAX_CHARS;
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return `Error: ${filePath} is not a file.`;
      if (!filePath.toLowerCase().endsWith('.docx')) return `Error: only .docx files are supported. Convert legacy .doc files to .docx first.`;
      if (fileStat.size > MAX_DOCX_SIZE) return `Error: DOCX is ${Math.round(fileStat.size / 1024 / 1024)} MB, exceeds 100 MB limit.`;

      const zip = await JSZip.loadAsync(await readFile(filePath));
      const documentXml = await zipText(zip, 'word/document.xml');
      if (!documentXml) return 'Error: invalid DOCX — missing word/document.xml.';

      const blocks = extractParagraphs(documentXml, (maxBlocks as number) || DEFAULT_MAX_BLOCKS);
      const tables = extractTables(documentXml, (maxTables as number) || 20, (maxRows as number) || 100, (maxCells as number) || 30);
      const coreMeta = metadataFromXml(await zipText(zip, 'docProps/core.xml'));
      const appMeta = metadataFromXml(await zipText(zip, 'docProps/app.xml'));
      const headers = await extractHeaderFooter(zip, 'header');
      const footers = await extractHeaderFooter(zip, 'footer');
      const comments = await extractComments(zip);
      const media = await extractMedia(zip);

      const out: string[] = [`DOCX: ${filePath}`, `Size: ${fileStat.size} bytes`, `Blocks: ${blocks.length}`, `Tables: ${tables.length}`, `Comments: ${comments.length}`, `Media: ${media.length}`, ''];

      const metadataText = () => {
        const lines = ['## Metadata'];
        const merged = { ...coreMeta, ...appMeta };
        const keys = Object.keys(merged).sort();
        if (keys.length === 0) lines.push('(none)');
        for (const key of keys) lines.push(`${key}: ${merged[key]}`);
        return lines.join('\n');
      };

      if (readMode === 'metadata' || readMode === 'all') out.push(metadataText(), '');
      if (readMode === 'text' || readMode === 'all') out.push(formatBlocks(blocks), '');
      if (readMode === 'tables' || readMode === 'all') out.push(formatTables(tables), '');
      if (readMode === 'headers' || readMode === 'all') {
        out.push(formatHeaderFooter('Headers', headers), '');
        out.push(formatHeaderFooter('Footers', footers), '');
      }
      if (readMode === 'comments' || readMode === 'all') out.push(formatComments(comments), '');
      if (readMode === 'media' || readMode === 'all') out.push(formatMedia(media), '');
      if (readMode === 'search') {
        const q = (query as string) || '';
        if (!q.trim()) return 'Error: mode="search" requires query.';
        const sections = [
          { source: 'Body text', text: blocks.map(b => b.text).join('\n') },
          { source: 'Tables', text: tables.flatMap(t => t.flat()).join('\n') },
          { source: 'Headers', text: headers.map(h => h.text).join('\n') },
          { source: 'Footers', text: footers.map(f => f.text).join('\n') },
          { source: 'Comments', text: comments.map(c => c.text).join('\n') },
        ];
        out.push(searchAll(sections, q, caseSensitive === true));
      }

      let result = out.join('\n');
      if (result.length > outputMaxChars) result = result.slice(0, outputMaxChars) + '\n...(docx output truncated)';
      return result;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading DOCX: ${msg}`;
    }
  },
};
