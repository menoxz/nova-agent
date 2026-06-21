# LSP V1 Capabilities

Implemented capabilities:

- `initialize`, `shutdown`, `exit` through the standard LSP lifecycle.
- Incremental text document sync.
- Diagnostics via `textDocument/publishDiagnostics` and diagnostic provider advertisement.
- Hover provider.
- Completion provider.
- Document symbols.
- Workspace symbols.
- Read-only `executeCommandProvider` commands:
  - `nova.lsp.showToolMetadata`
  - `nova.lsp.showRelatedDocs`
  - `nova.lsp.explainPolicy`
  - `nova.lsp.showEvalScenario`

Explicitly not implemented in V1:

- `WorkspaceEdit`.
- Write commands.
- Shell commands.
- MCP V1.1 HTTP transport.
