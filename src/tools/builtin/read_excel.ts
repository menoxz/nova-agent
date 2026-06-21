/**
 * Nova Agent — Tool: read_excel
 *
 * High-completeness XLSX reader based on ExcelJS.
 *
 * Capabilities:
 * - workbook metadata and defined names
 * - worksheet list, visibility, dimensions, merges, row/column counts
 * - cell ranges with values, formulas, formula results, notes/comments, hyperlinks
 * - text search across visible cell text, formula text, notes, hyperlinks
 * - Excel tables and worksheet images when detectable by ExcelJS
 *
 * Limits:
 * - XLS legacy files are not supported; convert .xls to .xlsx first.
 * - Formula values are cached results stored in the workbook; this tool does not recalculate formulas.
 * - Charts, pivots, slicers, macros/VBA, PowerQuery and external connections are future improvements.
 */

import { z } from 'zod';
import ExcelJS from 'exceljs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NovaTool } from '../../types.js';

const MAX_XLSX_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_MAX_ROWS = 100;
const DEFAULT_MAX_COLS = 30;
const DEFAULT_MAX_CHARS = 150_000;
const MAX_SEARCH_RESULTS = 200;

type RangeBounds = { top: number; left: number; bottom: number; right: number };

type CellInfo = {
  address: string;
  value: string;
  formula?: string;
  result?: string;
  note?: string;
  hyperlink?: string;
  type: string;
};

function colToNumber(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function numberToCol(n: number): string {
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

function address(row: number, col: number): string {
  return `${numberToCol(col)}${row}`;
}

function parseCellAddress(input: string): { row: number; col: number } | undefined {
  const m = input.trim().match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  if (!m) return undefined;
  return { col: colToNumber(m[1]), row: Number.parseInt(m[2], 10) };
}

function parseRange(range: string | undefined, fallback: RangeBounds): RangeBounds {
  if (!range || !range.trim()) return fallback;
  const cleaned = range.trim().replace(/^'[^']+'!/, '').replace(/^[^!]+!/, '');
  const [aRaw, bRaw] = cleaned.split(':');
  const a = parseCellAddress(aRaw);
  const b = parseCellAddress(bRaw || aRaw);
  if (!a || !b) return fallback;
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const v = value as any;
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text ?? '').join('');
    if (typeof v.text === 'string' && typeof v.hyperlink === 'string') return v.text;
    if (typeof v.formula === 'string') return valueToString(v.result);
    if (typeof v.sharedFormula === 'string') return valueToString(v.result);
    if (typeof v.error === 'string') return v.error;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function formulaFromValue(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const v = value as any;
    if (typeof v.formula === 'string') return v.formula;
    if (typeof v.sharedFormula === 'string') return `shared:${v.sharedFormula}`;
  }
  return undefined;
}

function formulaResultFromValue(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const v = value as any;
    if ('result' in v) return valueToString(v.result);
  }
  return undefined;
}

function hyperlinkFromCell(cell: ExcelJS.Cell): string | undefined {
  if (cell.hyperlink) return cell.hyperlink;
  const value = cell.value as any;
  if (value && typeof value === 'object' && typeof value.hyperlink === 'string') return value.hyperlink;
  return undefined;
}

function noteToString(note: ExcelJS.Cell['note']): string | undefined {
  if (!note) return undefined;
  if (typeof note === 'string') return note;
  const texts = (note as any).texts;
  if (Array.isArray(texts)) return texts.map((t: any) => t.text ?? '').join('');
  try { return JSON.stringify(note); } catch { return String(note); }
}

function cellTypeName(cell: ExcelJS.Cell): string {
  const names: Record<number, string> = {
    0: 'Null', 1: 'Merge', 2: 'Number', 3: 'String', 4: 'Date', 5: 'Hyperlink', 6: 'Formula', 7: 'SharedString', 8: 'RichText', 9: 'Boolean', 10: 'Error',
  };
  return names[cell.type] || String(cell.type);
}

function cellInfo(cell: ExcelJS.Cell): CellInfo {
  const formula = formulaFromValue(cell.value);
  const result = formulaResultFromValue(cell.value);
  const note = noteToString(cell.note);
  const hyperlink = hyperlinkFromCell(cell);
  return {
    address: cell.address,
    value: valueToString(cell.value),
    formula,
    result,
    note,
    hyperlink,
    type: cellTypeName(cell),
  };
}

function compactCell(info: CellInfo, includeEmpty: boolean): string | undefined {
  const parts: string[] = [];
  if (info.value) parts.push(info.value);
  if (info.formula) parts.push(`formula=${info.formula}`);
  if (info.result !== undefined && info.result !== info.value) parts.push(`result=${info.result}`);
  if (info.note) parts.push(`note=${info.note}`);
  if (info.hyperlink) parts.push(`link=${info.hyperlink}`);
  if (parts.length === 0 && !includeEmpty) return undefined;
  return `${info.address}: ${parts.join(' | ') || '(empty)'}`;
}

function sheetBounds(ws: ExcelJS.Worksheet): RangeBounds {
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let bottom = 0;
  let right = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const hasContent = valueToString(cell.value) || formulaFromValue(cell.value) || noteToString(cell.note) || hyperlinkFromCell(cell);
      if (!hasContent) return;
      top = Math.min(top, rowNumber);
      left = Math.min(left, colNumber);
      bottom = Math.max(bottom, rowNumber);
      right = Math.max(right, colNumber);
    });
  });
  if (!Number.isFinite(top)) return { top: 1, left: 1, bottom: 1, right: 1 };
  return { top, left, bottom, right };
}

function formatDate(d: unknown): string {
  return d instanceof Date && !Number.isNaN(d.valueOf()) ? d.toISOString() : '';
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

function formatMetadata(workbook: ExcelJS.Workbook, filePath: string, size: number): string {
  const lines = ['## Workbook Metadata', `File: ${filePath}`, `Size: ${size} bytes`, `Sheets: ${workbook.worksheets.length}`];
  const metadata: Record<string, string> = {
    title: workbook.title || '',
    subject: workbook.subject || '',
    creator: workbook.creator || '',
    lastModifiedBy: workbook.lastModifiedBy || '',
    created: formatDate(workbook.created),
    modified: formatDate(workbook.modified),
    lastPrinted: formatDate(workbook.lastPrinted),
    company: workbook.company || '',
    manager: workbook.manager || '',
    category: workbook.category || '',
    keywords: workbook.keywords || '',
    description: workbook.description || '',
    date1904: String((workbook.properties as any)?.date1904 ?? false),
    calcFullCalcOnLoad: String((workbook.calcProperties as any)?.fullCalcOnLoad ?? ''),
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value) lines.push(`${key}: ${value}`);
  }
  const defined = (workbook.definedNames as any)?.model;
  if (defined && Object.keys(defined).length > 0) {
    lines.push('', '### Defined Names');
    for (const [name, ranges] of Object.entries(defined)) lines.push(`- ${name}: ${safeJson(ranges)}`);
  }
  return lines.join('\n');
}

function formatSheets(workbook: ExcelJS.Workbook): string {
  const lines = ['## Sheets'];
  if (workbook.worksheets.length === 0) return '## Sheets\n(none)';
  workbook.worksheets.forEach((ws, idx) => {
    const bounds = sheetBounds(ws);
    const state = (ws as any).state || (ws as any).model?.state || 'visible';
    const merges = Object.keys((ws as any)._merges ?? {}).sort();
    const tables = safeGetTables(ws);
    const images = safeGetImages(ws);
    lines.push(`- ${idx + 1}. ${ws.name} | id=${ws.id} | state=${state} | rows=${ws.actualRowCount}/${ws.rowCount} | cols=${ws.actualColumnCount}/${ws.columnCount} | used=${address(bounds.top, bounds.left)}:${address(bounds.bottom, bounds.right)} | merges=${merges.length} | tables=${tables.length} | images=${images.length}`);
  });
  return lines.join('\n');
}

function formatRange(ws: ExcelJS.Worksheet, range: string | undefined, maxRows: number, maxCols: number, includeEmpty: boolean): string {
  const bounds = parseRange(range, sheetBounds(ws));
  const bottom = Math.min(bounds.bottom, bounds.top + maxRows - 1);
  const right = Math.min(bounds.right, bounds.left + maxCols - 1);
  const truncated = bottom < bounds.bottom || right < bounds.right;
  const lines = [`## Range ${ws.name}!${address(bounds.top, bounds.left)}:${address(bottom, right)}${truncated ? ' (truncated)' : ''}`];
  for (let r = bounds.top; r <= bottom; r++) {
    const rowParts: string[] = [];
    for (let c = bounds.left; c <= right; c++) {
      const line = compactCell(cellInfo(ws.getCell(r, c)), includeEmpty);
      if (line) rowParts.push(line);
    }
    if (rowParts.length > 0) lines.push(...rowParts);
  }
  if (lines.length === 1) lines.push('(no cells)');
  return lines.join('\n');
}

function formatFormulas(workbook: ExcelJS.Workbook, sheetName?: string): string {
  const lines = ['## Formulas'];
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    let sheetCount = 0;
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const info = cellInfo(cell);
        if (!info.formula) return;
        if (sheetCount === 0) lines.push(`\n### ${ws.name}`);
        lines.push(`${cell.address}: =${info.formula}${info.result !== undefined ? ` → ${info.result}` : ''}`);
        sheetCount++;
        total++;
      });
    });
  }
  if (total === 0) lines.push('(none)');
  return lines.join('\n');
}

function formatComments(workbook: ExcelJS.Workbook, sheetName?: string): string {
  const lines = ['## Comments / Notes'];
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    let sheetCount = 0;
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const note = noteToString(cell.note);
        if (!note) return;
        if (sheetCount === 0) lines.push(`\n### ${ws.name}`);
        lines.push(`${cell.address}: ${note}`);
        sheetCount++;
        total++;
      });
    });
  }
  if (total === 0) lines.push('(none)');
  return lines.join('\n');
}

function formatHyperlinks(workbook: ExcelJS.Workbook, sheetName?: string): string {
  const lines = ['## Hyperlinks'];
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    let sheetCount = 0;
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const link = hyperlinkFromCell(cell);
        if (!link) return;
        if (sheetCount === 0) lines.push(`\n### ${ws.name}`);
        lines.push(`${cell.address}: ${cell.text || valueToString(cell.value)} → ${link}`);
        sheetCount++;
        total++;
      });
    });
  }
  if (total === 0) lines.push('(none)');
  return lines.join('\n');
}

function safeGetTables(ws: ExcelJS.Worksheet): any[] {
  try {
    const raw = (ws as any).getTables?.();
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((item: any) => Array.isArray(item) ? item[0] : item).filter(Boolean);
    return Object.values(raw);
  } catch {
    const modelTables = (ws as any).model?.tables;
    return Array.isArray(modelTables) ? modelTables : [];
  }
}

function formatTables(workbook: ExcelJS.Workbook, sheetName?: string): string {
  const lines = ['## Tables'];
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    const tables = safeGetTables(ws);
    if (tables.length === 0) continue;
    lines.push(`\n### ${ws.name}`);
    for (const table of tables) {
      const model = (table as any).table || (table as any).model || table;
      const columns = Array.isArray(model.columns) ? model.columns.map((c: any) => c.name).join(', ') : '';
      lines.push(`- ${model.name || model.displayName || '(unnamed)'} | ref=${model.ref || model.tableRef || ''} | totalsRow=${model.totalsRow || false}${columns ? ` | columns=${columns}` : ''}`);
      total++;
    }
  }
  if (total === 0) lines.push('(none)');
  return lines.join('\n');
}

function safeGetImages(ws: ExcelJS.Worksheet): any[] {
  try { return ws.getImages?.() ?? []; } catch { return []; }
}

function formatImages(workbook: ExcelJS.Workbook, sheetName?: string): string {
  const lines = ['## Images'];
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    const images = safeGetImages(ws);
    if (images.length === 0) continue;
    lines.push(`\n### ${ws.name}`);
    for (const img of images) {
      const wbImage = workbook.getImage(Number(img.imageId)) as any;
      const ext = wbImage?.extension ? `.${wbImage.extension}` : '';
      const size = wbImage?.buffer?.length ?? wbImage?.base64?.length ?? 'unknown';
      lines.push(`- imageId=${img.imageId}${ext} | range=${imageRangeToString(img.range)} | size=${size}`);
      total++;
    }
  }
  if (total === 0) lines.push('(none)');
  return lines.join('\n');
}

function imageRangeToString(range: any): string {
  if (typeof range === 'string') return range;
  const tl = range?.tl;
  const br = range?.br;
  const pos = (p: any) => {
    if (!p) return '';
    const col = typeof p.nativeCol === 'number' ? p.nativeCol + 1 : undefined;
    const row = typeof p.nativeRow === 'number' ? p.nativeRow + 1 : undefined;
    return col && row ? address(row, col) : '';
  };
  const a = pos(tl);
  const b = pos(br);
  if (a && b) return `${a}:${b}`;
  return safeJson({ editAs: range?.editAs, tl: a || undefined, br: b || undefined });
}

function selectSheets(workbook: ExcelJS.Workbook, sheetName?: string): ExcelJS.Worksheet[] {
  if (!sheetName) return workbook.worksheets;
  const ws = workbook.getWorksheet(sheetName);
  return ws ? [ws] : [];
}

function formatSearch(workbook: ExcelJS.Workbook, query: string, caseSensitive: boolean, sheetName?: string): string {
  const lines = [`## Search: ${query}`];
  const needle = caseSensitive ? query : query.toLowerCase();
  let total = 0;
  for (const ws of selectSheets(workbook, sheetName)) {
    let sheetCount = 0;
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (total >= MAX_SEARCH_RESULTS) return;
        const info = cellInfo(cell);
        const hay = [info.value, info.formula, info.result, info.note, info.hyperlink].filter(Boolean).join(' | ');
        const hayCmp = caseSensitive ? hay : hay.toLowerCase();
        if (!hayCmp.includes(needle)) return;
        if (sheetCount === 0) lines.push(`\n### ${ws.name}`);
        const pos = hayCmp.indexOf(needle);
        const snippet = hay.slice(Math.max(0, pos - 80), Math.min(hay.length, pos + query.length + 120)).replace(/\s+/g, ' ').trim();
        lines.push(`${cell.address}: ...${snippet}...`);
        sheetCount++;
        total++;
      });
    });
  }
  lines.push(`\nTotal matches: ${total}`);
  return lines.join('\n');
}

export const readExcelTool: NovaTool = {
  name: 'read_excel',
  description: 'Read and inspect Excel XLSX files: workbook metadata, sheets/dimensions, ranges, values, formulas, comments/notes, hyperlinks, text search, tables and images when detectable. XLS legacy files are not supported.',
  capability: 'read',
  readOnly: true,
  riskLevel: 'low',
  inputSchema: z.object({
    path: z.string().describe('Absolute or workspace-relative path to the .xlsx file'),
    mode: z.enum(['metadata', 'sheets', 'range', 'formulas', 'comments', 'hyperlinks', 'tables', 'images', 'search', 'all']).optional().describe('Operation mode. Default: sheets.'),
    sheet: z.string().optional().describe('Worksheet name. Used by range/formulas/comments/hyperlinks/tables/images/search. Defaults to first sheet for range, all sheets otherwise.'),
    range: z.string().optional().describe('A1 range like A1:D20. Defaults to the worksheet used range.'),
    query: z.string().optional().describe('Search query. Required for mode="search".'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default: false).'),
    includeEmpty: z.boolean().optional().describe('Include empty cells in range output (default: false).'),
    maxRows: z.number().int().min(1).max(5000).optional().describe(`Max rows for range output (default: ${DEFAULT_MAX_ROWS}).`),
    maxCols: z.number().int().min(1).max(200).optional().describe(`Max columns for range output (default: ${DEFAULT_MAX_COLS}).`),
    maxChars: z.number().int().min(1000).max(1_000_000).optional().describe(`Max output chars (default: ${DEFAULT_MAX_CHARS}).`),
  }),
  execute: async ({ path, mode, sheet, range, query, caseSensitive, includeEmpty, maxRows, maxCols, maxChars }) => {
    const filePath = resolve(path as string);
    const readMode = (mode as string) || 'sheets';
    const outputMaxChars = (maxChars as number) || DEFAULT_MAX_CHARS;

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return `Error: ${filePath} is not a file.`;
      if (!filePath.toLowerCase().endsWith('.xlsx')) return 'Error: only .xlsx files are supported. Convert legacy .xls files to .xlsx first.';
      if (fileStat.size > MAX_XLSX_SIZE) return `Error: XLSX is ${Math.round(fileStat.size / 1024 / 1024)} MB, exceeds 100 MB limit.`;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const out: string[] = [`XLSX: ${filePath}`, ''];

      if (readMode === 'metadata' || readMode === 'all') out.push(formatMetadata(workbook, filePath, fileStat.size), '');
      if (readMode === 'sheets' || readMode === 'all') out.push(formatSheets(workbook), '');
      if (readMode === 'range' || readMode === 'all') {
        const ws = sheet ? workbook.getWorksheet(sheet as string) : workbook.worksheets[0];
        if (!ws) return `Error: worksheet not found${sheet ? `: ${sheet}` : ''}.`;
        out.push(formatRange(ws, range as string | undefined, (maxRows as number) || DEFAULT_MAX_ROWS, (maxCols as number) || DEFAULT_MAX_COLS, includeEmpty === true), '');
      }
      if (readMode === 'formulas' || readMode === 'all') out.push(formatFormulas(workbook, sheet as string | undefined), '');
      if (readMode === 'comments' || readMode === 'all') out.push(formatComments(workbook, sheet as string | undefined), '');
      if (readMode === 'hyperlinks' || readMode === 'all') out.push(formatHyperlinks(workbook, sheet as string | undefined), '');
      if (readMode === 'tables' || readMode === 'all') out.push(formatTables(workbook, sheet as string | undefined), '');
      if (readMode === 'images' || readMode === 'all') out.push(formatImages(workbook, sheet as string | undefined), '');
      if (readMode === 'search') {
        const q = (query as string) || '';
        if (!q.trim()) return 'Error: mode="search" requires query.';
        out.push(formatSearch(workbook, q, caseSensitive === true, sheet as string | undefined), '');
      }

      let result = out.join('\n');
      if (result.length > outputMaxChars) result = result.slice(0, outputMaxChars) + '\n...(xlsx output truncated)';
      return result;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading XLSX: ${msg}`;
    }
  },
};
