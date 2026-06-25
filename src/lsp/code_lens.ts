import type { CodeLens } from 'vscode-languageserver/node';
import { Range } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { NovaMetadataIndex } from './metadata.js';
import { findMetadataAtText } from './metadata.js';

function lineRange(line: number): Range {
  return Range.create(line, 0, line, 0);
}

export function codeLensesFor(document: TextDocument, metadata: NovaMetadataIndex): CodeLens[] {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const lenses: CodeLens[] = [];
  const seen = new Set<string>();

  for (let line = 0; line < lines.length && lenses.length < 25; line += 1) {
    const content = lines[line] ?? '';
    const item = findMetadataAtText(content, metadata);
    if (!item) continue;
    const key = `${line}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const command = item.kind === 'doc'
      ? { title: 'Nova: show related docs', command: 'nova.lsp.showRelatedDocs', arguments: [item.label] }
      : item.kind === 'eval'
        ? { title: 'Nova: show eval scenario', command: 'nova.lsp.showEvalScenario', arguments: [item.label] }
        : { title: `Nova: inspect ${item.kind} metadata`, command: 'nova.lsp.showToolMetadata', arguments: [item.label] };

    lenses.push({ range: lineRange(line), command, data: { readOnly: true, metadataId: item.id } });
  }

  return lenses;
}
