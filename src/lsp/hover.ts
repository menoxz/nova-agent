import { MarkupKind } from 'vscode-languageserver/node';
import type { Hover, Position } from 'vscode-languageserver/node';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import type { NovaMetadataIndex } from './metadata.js';
import { findMetadataAtText, formatMetadataItem } from './metadata.js';

function wordWindow(document: TextDocument, position: Position): string {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const tokenStart = text.slice(0, offset).search(/[A-Za-z0-9_:/.-]*$/);
  const left = tokenStart >= 0 ? text.slice(0, offset).slice(tokenStart) : '';
  const right = /^[A-Za-z0-9_:/.-]*/.exec(text.slice(offset))?.[0] ?? '';
  const token = `${left}${right}`;
  if (token) return token;
  const start = Math.max(0, offset - 120);
  const end = Math.min(text.length, offset + 120);
  return text.slice(start, end);
}

export function hoverFor(document: TextDocument, position: Position, metadata: NovaMetadataIndex): Hover | null {
  const item = findMetadataAtText(wordWindow(document, position), metadata);
  if (!item) return null;
  return { contents: { kind: MarkupKind.Markdown, value: formatMetadataItem(item) } };
}
