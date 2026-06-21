import { DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { NovaMetadataIndex } from './metadata.js';
import { EXPECTED_SCRIPTS, LSP_COMMANDS } from './metadata.js';

function rangeFromIndex(text: string, index: number, length: number): Range {
  const before = text.slice(0, index).split(/\r?\n/);
  const line = before.length - 1;
  const character = before.at(-1)?.length ?? 0;
  return Range.create(line, character, line, character + length);
}

function pushMatchDiagnostics(out: Diagnostic[], text: string, regex: RegExp, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Warning): void {
  for (const match of text.matchAll(regex)) {
    const value = match[0];
    if (typeof match.index !== 'number') continue;
    out.push({ range: rangeFromIndex(text, match.index, value.length), severity, source: 'nova-lsp', message });
  }
}

export function computeDiagnostics(document: TextDocument, metadata: NovaMetadataIndex): Diagnostic[] {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];

  if (document.uri.endsWith('/package.json') || document.uri.endsWith('\\package.json')) {
    for (const script of EXPECTED_SCRIPTS) {
      if (!metadata.packageScripts.includes(script)) {
        diagnostics.push({ range: Range.create(0, 0, 0, 1), severity: DiagnosticSeverity.Warning, source: 'nova-lsp', message: `Missing expected Nova script: ${script}` });
      }
    }
  }

  const labels = new Map<string, string[]>();
  for (const item of metadata.items) {
    const current = labels.get(item.label) ?? [];
    current.push(item.id);
    labels.set(item.label, current);
  }
  for (const [label, ids] of labels) {
    if (ids.length > 1 && text.includes(label)) {
      const idx = text.indexOf(label);
      diagnostics.push({ range: rangeFromIndex(text, idx, label.length), severity: DiagnosticSeverity.Information, source: 'nova-lsp', message: `Duplicate Nova metadata label "${label}" appears in: ${ids.join(', ')}` });
    }
  }

  pushMatchDiagnostics(diagnostics, text, /(?:^|[\s`'\"])(?:\.env(?:\.[\w-]+)?)(?=$|[\s`'\".,;:])/g, 'Sensitive .env paths must not be exposed through LSP metadata or docs.');
  pushMatchDiagnostics(diagnostics, text, /\.nova[\\/](?:traces|evals|reports)[^\s`'\"]*/gi, 'Raw .nova traces/evals/reports are denied; expose only sanitized metadata or summaries.');
  pushMatchDiagnostics(diagnostics, text, /(?:BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY|api[_-]?key\s*[:=]|authorization\s*[:=]|password\s*[:=])/gi, 'Secret-like content mention detected; verify it is synthetic, redacted, or removed.', DiagnosticSeverity.Error);

  for (const command of LSP_COMMANDS) {
    if (!metadata.byId.has(`command:${command}`)) {
      diagnostics.push({ range: Range.create(0, 0, 0, 1), severity: DiagnosticSeverity.Warning, source: 'nova-lsp', message: `Missing LSP command metadata: ${command}` });
    }
  }

  return diagnostics.slice(0, 100);
}
