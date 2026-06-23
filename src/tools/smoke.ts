#!/usr/bin/env node
/**
 * Nova Agent — Offline read-only tools smoke
 *
 * Exercises every READ-ONLY builtin tool's `execute()` against fixtures that are
 * generated at runtime inside an OS temp directory. Each tool gets a happy-path
 * assertion (key output substrings) plus at least one error/edge case asserting a
 * structured error string (never an unhandled throw).
 *
 * Offline guarantees:
 * - No network: every fixture is built locally (text, docx via JSZip, xlsx via
 *   ExcelJS, a hand-rolled minimal PDF). pdfjs reads standard fonts from disk.
 * - No secrets: no .env / credentials are read; tools only touch the temp tree.
 * - Deterministic: fixtures are fixed bytes, the SHA256 assertion is computed from
 *   the exact fixture content, and grep's needles sit on non-final, scattered lines
 *   so the reported 1-based line numbers are asserted exactly.
 *
 * Coverage:
 *   read_file, glob, grep, list_directory, get_file_info, read_docx, read_excel, read_pdf.
 * Intentionally skipped:
 *   - write_file / bash      → mutating, out of read-only scope.
 *   - web_search             → requires network.
 *   - git                    → spawns an external `git` subprocess (non-hermetic).
 *
 * Regression guard: grep must report the TRUE 1-based line number of every match.
 * The grep fixture places matches on non-final, scattered lines (2 and 5) and the
 * happy-path asserts those exact numbers, so any off-by-context regression in the
 * close handler of grep.ts (the line-number arithmetic) is caught here.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { readFileTool } from './builtin/read_file.js';
import { globTool } from './builtin/glob.js';
import { grepTool } from './builtin/grep.js';
import { listDirectoryTool } from './builtin/list_directory.js';
import { getFileInfoTool } from './builtin/get_file_info.js';
import { readDocxTool } from './builtin/read_docx.js';
import { readExcelTool } from './builtin/read_excel.js';
import { readPdfTool } from './builtin/read_pdf.js';
import type { NovaTool } from '../types.js';

/** Call a tool's execute() and coerce the result to a plain string for assertions. */
async function run(tool: NovaTool, input: Record<string, unknown>): Promise<string> {
  const out = await tool.execute(input);
  if (typeof out === 'string') return out;
  // Every read-only tool under test returns a string; handle the structured
  // ToolResultOutput union defensively so this stays type-safe if that changes.
  if (out.type === 'execution-denied') return `[execution-denied]${out.reason ? ` ${out.reason}` : ''}`;
  // Remaining members ('text' | 'json' | 'error-text' | 'error-json') all carry `value`.
  const val: unknown = out.value;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

function has(haystack: string, needle: string, label: string): void {
  assert.ok(
    haystack.includes(needle),
    `${label}: expected output to contain ${JSON.stringify(needle)}\n--- actual ---\n${haystack}\n--------------`,
  );
}

/**
 * Build a minimal, valid single-page PDF with extractable text, computing real
 * byte offsets for the xref table. latin1 keeps byteLength === string length.
 */
function buildMinimalPdf(text: string): Buffer {
  const objects: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET\n`;
  objects[4] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += xref;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function buildDocx(filePath: string, text: string): Promise<void> {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(filePath, buf);
}

async function buildXlsx(filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A1').value = 'Hello';
  ws.getCell('B1').value = 'Nova';
  ws.getCell('A2').value = 42;
  await wb.xlsx.writeFile(filePath);
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'nova-tools-smoke-'));
  try {
    // --- Fixtures -----------------------------------------------------------
    const textPath = join(tmp, 'a.txt');
    const textContent = 'alpha line\nbeta line\ngamma line';
    await writeFile(textPath, textContent, 'utf-8');

    const docxPath = join(tmp, 'doc.docx');
    await buildDocx(docxPath, 'Hello Nova Docx');

    const xlsxPath = join(tmp, 'book.xlsx');
    await buildXlsx(xlsxPath);

    const pdfPath = join(tmp, 'sample.pdf');
    await writeFile(pdfPath, buildMinimalPdf('Hello Nova PDF'));

    const grepDir = join(tmp, 'grepdir');
    await mkdir(grepDir);
    // Needles on line 2 and line 5 — NEITHER is the last line — so a correct grep
    // must report the TRUE 1-based line numbers (2 and 5), not values that only
    // happen to be right when the single match sits on the final line.
    await writeFile(
      join(grepDir, 'g.txt'),
      'first line\nNEEDLEGREP marker\nthird line\nfourth line\nNEEDLEGREP again\nsixth line',
      'utf-8',
    );

    const listDir = join(tmp, 'listdir');
    await mkdir(listDir);
    await writeFile(join(listDir, 'a.txt'), 'x', 'utf-8');
    await mkdir(join(listDir, 'sub'));

    // --- read_file ----------------------------------------------------------
    {
      const ok = await run(readFileTool, { path: textPath });
      has(ok, 'Media type: text/plain', 'read_file happy');
      has(ok, 'Lines: 3', 'read_file happy');
      has(ok, 'alpha line', 'read_file happy');

      const missing = await run(readFileTool, { path: join(tmp, 'nope.txt') });
      has(missing, 'file not found at', 'read_file missing');

      const onDir = await run(readFileTool, { path: listDir });
      has(onDir, 'is not a file', 'read_file on dir');
    }

    // --- glob ---------------------------------------------------------------
    {
      const ok = await run(globTool, { pattern: '*.docx', root: tmp });
      has(ok, 'Found 1 file(s):', 'glob happy');
      has(ok, 'doc.docx', 'glob happy');

      const none = await run(globTool, { pattern: '*.zzz', root: tmp });
      has(none, 'No files found matching', 'glob no-match');
    }

    // --- grep ---------------------------------------------------------------
    {
      // Two scattered matches (lines 2 and 5), neither on the last line, so the
      // returned line numbers must be the TRUE 1-based positions. This fails the
      // off-by-context bug in grep.ts's close handler, which would report 5 and 6.
      const ok = await run(grepTool, { pattern: 'NEEDLEGREP', root: grepDir, include: '*.txt' });
      has(ok, 'Found 2 match(es):', 'grep happy');
      has(ok, '2: NEEDLEGREP marker', 'grep mid-file line number');
      has(ok, '5: NEEDLEGREP again', 'grep scattered line number');

      const none = await run(grepTool, { pattern: 'ZZZNOTFOUND', root: grepDir });
      has(none, 'No matching lines found', 'grep no-match');

      const badRe = await run(grepTool, { pattern: '(', root: grepDir });
      has(badRe, 'invalid regex pattern', 'grep invalid regex');
    }

    // --- list_directory -----------------------------------------------------
    {
      const ok = await run(listDirectoryTool, { path: listDir });
      has(ok, '1 directories, 1 files', 'list_directory happy');
      has(ok, 'sub/', 'list_directory happy');
      has(ok, 'a.txt', 'list_directory happy');

      const missing = await run(listDirectoryTool, { path: join(tmp, 'no-such-dir') });
      has(missing, 'directory not found', 'list_directory missing');
    }

    // --- get_file_info ------------------------------------------------------
    {
      const expectedHash = createHash('sha256').update(Buffer.from(textContent, 'utf-8')).digest('hex');
      const ok = await run(getFileInfoTool, { path: textPath, hash: true });
      has(ok, 'Type: 📄 File', 'get_file_info happy');
      has(ok, 'MIME: text/plain', 'get_file_info happy');
      has(ok, `SHA256: ${expectedHash}`, 'get_file_info hash');

      const missing = await run(getFileInfoTool, { path: join(tmp, 'ghost.txt') });
      has(missing, 'Path not found', 'get_file_info missing');
    }

    // --- read_docx ----------------------------------------------------------
    {
      const ok = await run(readDocxTool, { path: docxPath });
      has(ok, 'Blocks: 1', 'read_docx happy');
      has(ok, '## Structured Text', 'read_docx happy');
      has(ok, '1. Hello Nova Docx', 'read_docx happy');

      const wrongExt = await run(readDocxTool, { path: textPath });
      has(wrongExt, 'only .docx files are supported', 'read_docx wrong ext');
    }

    // --- read_excel ---------------------------------------------------------
    {
      const sheets = await run(readExcelTool, { path: xlsxPath });
      has(sheets, '## Sheets', 'read_excel sheets');
      has(sheets, 'Data', 'read_excel sheets');

      const range = await run(readExcelTool, { path: xlsxPath, mode: 'range', range: 'A1:B2' });
      has(range, '## Range Data!A1:B2', 'read_excel range');
      has(range, 'A1: Hello', 'read_excel range');
      has(range, 'A2: 42', 'read_excel range');

      const wrongExt = await run(readExcelTool, { path: textPath });
      has(wrongExt, 'only .xlsx files are supported', 'read_excel wrong ext');
    }

    // --- read_pdf -----------------------------------------------------------
    {
      const ok = await run(readPdfTool, { path: pdfPath });
      has(ok, 'Pages: 1', 'read_pdf happy');
      has(ok, '## Text', 'read_pdf happy');
      has(ok, '### Page 1 (612x792)', 'read_pdf happy');
      has(ok, 'Hello Nova PDF', 'read_pdf happy');

      // No extension guard in read_pdf → a non-PDF input is caught as a parse error.
      const notPdf = await run(readPdfTool, { path: textPath });
      has(notPdf, 'Error reading PDF:', 'read_pdf non-pdf');
    }

    console.log('tools:smoke (offline read-only tools) passed — 8 tools, git skipped (subprocess)');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('tools:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
