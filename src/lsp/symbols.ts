import { Location, Range } from 'vscode-languageserver/node';
import type { DocumentSymbolParams, SymbolInformation, WorkspaceSymbolParams } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { metadataKindToSymbolKind } from './capabilities.js';
import type { NovaMetadataIndex } from './metadata.js';

function rangeFromIndex(text: string, index: number, length: number): Range {
  const before = text.slice(0, index).split(/\r?\n/);
  const line = before.length - 1;
  const character = before.at(-1)?.length ?? 0;
  return Range.create(line, character, line, character + length);
}

export function documentSymbols(params: DocumentSymbolParams, document: TextDocument | undefined, metadata: NovaMetadataIndex): SymbolInformation[] {
  if (!document) return [];
  const text = document.getText();
  const out: SymbolInformation[] = [];
  for (const item of metadata.items) {
    const idx = text.indexOf(item.label);
    if (idx < 0) continue;
    out.push({
      name: item.label,
      kind: metadataKindToSymbolKind[item.kind],
      location: Location.create(params.textDocument.uri, rangeFromIndex(text, idx, item.label.length)),
      containerName: `Nova ${item.kind}`,
    });
  }
  return out.slice(0, 200);
}

export function workspaceSymbols(params: WorkspaceSymbolParams, metadata: NovaMetadataIndex): SymbolInformation[] {
  const query = params.query.toLowerCase();
  return metadata.items
    .filter((item) => !query || item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query) || item.tags?.some((tag) => tag.toLowerCase().includes(query)))
    .slice(0, 200)
    .map((item) => ({
      name: item.label,
      kind: metadataKindToSymbolKind[item.kind],
      location: Location.create(`nova-metadata://${item.kind}/${encodeURIComponent(item.id)}`, Range.create(0, 0, 0, item.label.length)),
      containerName: `Nova ${item.kind}`,
    }));
}
