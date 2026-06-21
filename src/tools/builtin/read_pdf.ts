/**
 * Nova Agent — Tool: read_pdf
 *
 * High-completeness PDF reader built on pdfjs-dist.
 * Capabilities:
 * - metadata / document info
 * - text extraction page by page
 * - page ranges: "1", "1,3", "2-5", "1,4-6"
 * - outline / bookmarks
 * - annotations per page
 * - text search with snippets
 *
 * Limits:
 * - Not OCR: scanned PDFs without embedded text need a future OCR tool.
 * - Tables are not reconstructed perfectly; future table extraction can be separate.
 */

import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { NovaTool } from '../../types.js';

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_CHARS_PER_PAGE = 20_000;
const MAX_SEARCH_RESULTS = 100;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const require = createRequire(import.meta.url);
const pdfjsPackageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = pathToFileURL(join(pdfjsPackageRoot, 'standard_fonts') + '/').href;

async function loadPdfJs(): Promise<PdfJs> {
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}

function parsePageRange(range: string | undefined, totalPages: number, maxPages: number): number[] {
  if (!range || range.trim() === '') {
    return Array.from({ length: Math.min(totalPages, maxPages) }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  for (const part of range.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [aRaw, bRaw] = trimmed.split('-').map(s => s.trim());
      const a = Number.parseInt(aRaw, 10);
      const b = Number.parseInt(bRaw, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const start = Math.max(1, Math.min(a, b));
      const end = Math.min(totalPages, Math.max(a, b));
      for (let p = start; p <= end; p++) pages.add(p);
    } else {
      const p = Number.parseInt(trimmed, 10);
      if (Number.isFinite(p) && p >= 1 && p <= totalPages) pages.add(p);
    }
  }

  return Array.from(pages).sort((a, b) => a - b).slice(0, maxPages);
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function formatMetadata(metadataResult: any, pdf: any): string {
  const lines: string[] = [];
  const info = metadataResult?.info ?? {};
  const metadata = metadataResult?.metadata;
  const metadataAll = metadata?.getAll ? metadata.getAll() : undefined;

  lines.push('## Metadata');
  lines.push(`Pages: ${pdf.numPages}`);
  if (pdf.fingerprints?.length) lines.push(`Fingerprint: ${pdf.fingerprints.join(', ')}`);
  lines.push('');

  lines.push('### Document Info');
  const keys = Object.keys(info).sort();
  if (keys.length === 0) lines.push('(none)');
  for (const key of keys) {
    lines.push(`${key}: ${safeString(info[key])}`);
  }

  if (metadataAll && Object.keys(metadataAll).length > 0) {
    lines.push('');
    lines.push('### XMP Metadata');
    for (const key of Object.keys(metadataAll).sort()) {
      lines.push(`${key}: ${safeString(metadataAll[key])}`);
    }
  }

  return lines.join('\n');
}

function flattenOutline(items: any[] | null | undefined, depth = 0, lines: string[] = []): string[] {
  if (!items || items.length === 0) return lines;
  for (const item of items) {
    const indent = '  '.repeat(depth);
    const title = item.title || '(untitled)';
    const dest = item.dest ? ` → ${safeString(item.dest).slice(0, 120)}` : '';
    const url = item.url ? ` (${item.url})` : '';
    lines.push(`${indent}- ${title}${url}${dest}`);
    if (item.items?.length) flattenOutline(item.items, depth + 1, lines);
  }
  return lines;
}

function textItemsToLines(items: any[]): string[] {
  const positioned = items
    .filter((item: any) => typeof item.str === 'string' && item.str.length > 0)
    .map((item: any) => ({
      str: item.str,
      x: Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0,
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);

  const lines: Array<{ y: number; parts: string[] }> = [];
  for (const item of positioned) {
    const existing = lines.find(line => Math.abs(line.y - item.y) <= 2);
    if (existing) existing.parts.push(item.str);
    else lines.push({ y: item.y, parts: [item.str] });
  }

  return lines.map(line => line.parts.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function extractPageText(pdf: any, pageNumber: number, maxChars: number): Promise<{ text: string; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const lines = textItemsToLines(textContent.items as any[]);
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n...(page text truncated)';
  return { text, width: viewport.width, height: viewport.height };
}

async function extractAnnotations(pdf: any, pageNumber: number): Promise<any[]> {
  const page = await pdf.getPage(pageNumber);
  const annotations = await page.getAnnotations({ intent: 'display' });
  return annotations.map((a: any) => ({
    subtype: a.subtype,
    title: a.title || undefined,
    contents: a.contents || undefined,
    url: a.url || undefined,
    dest: a.dest || undefined,
    rect: a.rect || undefined,
    fieldName: a.fieldName || undefined,
    fieldValue: a.fieldValue || undefined,
  }));
}

function formatAnnotations(pageNumber: number, annotations: any[]): string {
  const lines: string[] = [`## Page ${pageNumber} annotations`];
  if (annotations.length === 0) {
    lines.push('(none)');
    return lines.join('\n');
  }

  annotations.forEach((a, idx) => {
    lines.push(`### Annotation ${idx + 1}`);
    for (const [key, value] of Object.entries(a)) {
      if (value !== undefined && value !== null && value !== '') lines.push(`${key}: ${safeString(value)}`);
    }
  });
  return lines.join('\n');
}

function searchText(text: string, query: string, caseSensitive: boolean): Array<{ index: number; snippet: string }> {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: Array<{ index: number; snippet: string }> = [];
  if (!needle) return results;

  let pos = 0;
  while (results.length < MAX_SEARCH_RESULTS) {
    const found = haystack.indexOf(needle, pos);
    if (found === -1) break;
    const start = Math.max(0, found - 80);
    const end = Math.min(text.length, found + query.length + 120);
    results.push({ index: found, snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() });
    pos = found + Math.max(1, needle.length);
  }
  return results;
}

export const readPdfTool: NovaTool = {
  name: 'read_pdf',
  description: 'Read and inspect PDF files: metadata, text per page, page ranges, outline/bookmarks, annotations, and text search. Not OCR for scanned PDFs.',
  capability: 'read',
  readOnly: true,
  riskLevel: 'low',
  inputSchema: z.object({
    path: z.string().describe('Absolute or workspace-relative path to the PDF file'),
    mode: z.enum(['metadata', 'text', 'outline', 'annotations', 'search', 'all']).optional()
      .describe('Operation mode. Default: text.'),
    pages: z.string().optional().describe('Page range: "1", "1,3", "2-5", "1,4-6". Default: first pages up to maxPages.'),
    query: z.string().optional().describe('Search query. Required for mode="search".'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default: false).'),
    maxPages: z.number().int().min(1).max(200).optional().describe(`Max pages to process (default: ${DEFAULT_MAX_PAGES}).`),
    maxCharsPerPage: z.number().int().min(500).max(100_000).optional().describe(`Max extracted chars per page (default: ${DEFAULT_MAX_CHARS_PER_PAGE}).`),
    includeAnnotations: z.boolean().optional().describe('Include annotations in text/all mode (default: false for text, true for all).'),
  }),
  execute: async ({ path, mode, pages, query, caseSensitive, maxPages, maxCharsPerPage, includeAnnotations }) => {
    const filePath = resolve(path as string);
    const readMode = (mode as string) || 'text';
    const maxPageCount = (maxPages as number) || DEFAULT_MAX_PAGES;
    const maxChars = (maxCharsPerPage as number) || DEFAULT_MAX_CHARS_PER_PAGE;
    const withAnnotations = includeAnnotations === true || readMode === 'all';

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return `Error: ${filePath} is not a file.`;
      if (fileStat.size > MAX_PDF_SIZE) return `Error: PDF is ${Math.round(fileStat.size / 1024 / 1024)} MB, exceeds 100 MB limit.`;

      const pdfjsLib = await loadPdfJs();
      const data = new Uint8Array(await readFile(filePath));
      const loadingTask = pdfjsLib.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
        standardFontDataUrl,
        verbosity: pdfjsLib.VerbosityLevel.ERRORS,
      } as any);
      const pdf = await loadingTask.promise;
      const selectedPages = parsePageRange(pages as string | undefined, pdf.numPages, maxPageCount);
      const output: string[] = [`PDF: ${filePath}`, `Size: ${fileStat.size} bytes`, `Pages: ${pdf.numPages}`, ''];

      if (readMode === 'metadata' || readMode === 'all') {
        const metadata = await pdf.getMetadata().catch((err: unknown) => ({ info: { error: String(err) } }));
        output.push(formatMetadata(metadata, pdf), '');
      }

      if (readMode === 'outline' || readMode === 'all') {
        const outline = await pdf.getOutline().catch(() => null);
        output.push('## Outline');
        const outlineLines = flattenOutline(outline);
        output.push(outlineLines.length > 0 ? outlineLines.join('\n') : '(none)', '');
      }

      if (readMode === 'annotations' || withAnnotations) {
        output.push('## Annotations');
        for (const pageNumber of selectedPages) {
          const annotations = await extractAnnotations(pdf, pageNumber);
          output.push(formatAnnotations(pageNumber, annotations), '');
        }
      }

      if (readMode === 'search') {
        const q = (query as string) || '';
        if (!q.trim()) return 'Error: mode="search" requires query.';
        output.push(`## Search: ${q}`);
        let total = 0;
        for (const pageNumber of selectedPages) {
          const { text } = await extractPageText(pdf, pageNumber, maxChars);
          const matches = searchText(text, q, caseSensitive === true);
          if (matches.length > 0) {
            output.push(`### Page ${pageNumber}: ${matches.length} match(es)`);
            matches.forEach((m, idx) => output.push(`${idx + 1}. ...${m.snippet}...`));
            total += matches.length;
          }
        }
        output.push('', `Total matches: ${total}`);
      }

      if (readMode === 'text' || readMode === 'all') {
        output.push(`## Text (${selectedPages.length} page(s): ${selectedPages.join(', ')})`);
        for (const pageNumber of selectedPages) {
          const { text, width, height } = await extractPageText(pdf, pageNumber, maxChars);
          output.push(`\n### Page ${pageNumber} (${Math.round(width)}x${Math.round(height)})`);
          output.push(text || '(no extractable text — maybe scanned PDF or image-only page)');
        }
      }

      await (pdf as any).destroy?.();
      return output.join('\n');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('password')) return `Error: PDF appears to be password-protected: ${msg}`;
      return `Error reading PDF: ${msg}`;
    }
  },
};
