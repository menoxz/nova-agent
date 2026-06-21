import { CompletionItemKind, SymbolKind, TextDocumentSyncKind } from 'vscode-languageserver/node';
import type { ServerCapabilities } from 'vscode-languageserver/node';

import { LSP_COMMANDS } from './metadata.js';

export const metadataKindToCompletionKind: Record<string, CompletionItemKind> = {
  script: CompletionItemKind.Function,
  tool: CompletionItemKind.Method,
  resource: CompletionItemKind.Reference,
  prompt: CompletionItemKind.Text,
  doc: CompletionItemKind.File,
  eval: CompletionItemKind.EnumMember,
  policy: CompletionItemKind.Value,
  command: CompletionItemKind.Event,
};

export const metadataKindToSymbolKind: Record<string, SymbolKind> = {
  script: SymbolKind.Function,
  tool: SymbolKind.Method,
  resource: SymbolKind.Namespace,
  prompt: SymbolKind.String,
  doc: SymbolKind.File,
  eval: SymbolKind.Event,
  policy: SymbolKind.Object,
  command: SymbolKind.Function,
};

export function createCapabilities(): ServerCapabilities {
  return {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
    completionProvider: { resolveProvider: false, triggerCharacters: ['n', 'N', ':', '/', '@'] },
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    executeCommandProvider: { commands: [...LSP_COMMANDS] },
    diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
    workspace: { workspaceFolders: { supported: false, changeNotifications: false } },
  } as ServerCapabilities;
}
