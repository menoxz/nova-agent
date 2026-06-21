import type { CompletionItem } from 'vscode-languageserver/node';

import { metadataKindToCompletionKind } from './capabilities.js';
import type { NovaMetadataIndex } from './metadata.js';

export function completionItems(metadata: NovaMetadataIndex): CompletionItem[] {
  return metadata.items.map((item) => ({
    label: item.label,
    kind: metadataKindToCompletionKind[item.kind],
    detail: item.detail,
    documentation: item.documentation,
    data: item.id,
  })).slice(0, 200);
}
