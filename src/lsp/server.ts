#!/usr/bin/env node

import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
} from 'vscode-languageserver/node';
import type { InitializeParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { createCapabilities } from './capabilities.js';
import { completionItems } from './completion.js';
import { runReadOnlyCommand } from './commands.js';
import { computeDiagnostics } from './diagnostics.js';
import { hoverFor } from './hover.js';
import { buildMetadataIndex } from './metadata.js';
import type { NovaMetadataIndex } from './metadata.js';
import { LSP_VERSION, PROJECT_ROOT, safeError } from './policy.js';
import { documentSymbols, workspaceSymbols } from './symbols.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let metadata: NovaMetadataIndex | undefined;

async function getMetadata(): Promise<NovaMetadataIndex> {
  metadata ??= await buildMetadataIndex();
  return metadata;
}

function publishDiagnostics(document: TextDocument): void {
  void getMetadata().then((index) => {
    connection.sendDiagnostics({ uri: document.uri, diagnostics: computeDiagnostics(document, index) });
  }).catch((err) => {
    connection.console.warn(`Nova LSP diagnostics unavailable: ${safeError(err)}`);
  });
}

connection.onInitialize((_params: InitializeParams) => ({
  capabilities: createCapabilities(),
  serverInfo: { name: 'nova-agent-lsp', version: LSP_VERSION },
}));

connection.onInitialized(() => {
  void getMetadata().then((index) => {
    connection.console.info(`Nova LSP V1 ready with ${index.items.length} safe metadata items.`);
  }).catch((err) => connection.console.warn(`Nova LSP metadata unavailable: ${safeError(err)}`));
});

documents.onDidOpen((event) => publishDiagnostics(event.document));
documents.onDidChangeContent((event) => publishDiagnostics(event.document));
documents.onDidClose((event) => connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }));

connection.onHover(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  return hoverFor(document, params.position, await getMetadata());
});

connection.onCompletion(async () => completionItems(await getMetadata()));

connection.onDocumentSymbol(async (params) => documentSymbols(params, documents.get(params.textDocument.uri), await getMetadata()));

connection.onWorkspaceSymbol(async (params) => workspaceSymbols(params, await getMetadata()));

connection.onExecuteCommand(async (params) => runReadOnlyCommand(params, await getMetadata()));

connection.onShutdown(() => undefined);

process.on('uncaughtException', (err) => {
  connection.console.error(`Nova LSP uncaught error: ${safeError(err)}`);
});

process.on('unhandledRejection', (err) => {
  connection.console.error(`Nova LSP unhandled rejection: ${safeError(err)}`);
});

void getMetadata().catch(() => undefined);
documents.listen(connection);
connection.listen();

export const novaLspProjectRoot = PROJECT_ROOT;
