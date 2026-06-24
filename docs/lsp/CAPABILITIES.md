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
  - `nova.lsp.showSetupGuide`
  - `nova.lsp.showTelemetrySummary`

V1.1 validation adds `npm run lsp:policy-smoke`, which asserts the capability allowlist and confirms no mutating LSP capability is advertised.

V1.1 metadata indexing derives additional MCP tool/resource/prompt entries from `src/mcp/server.ts` registrations. These entries are metadata only, tagged `source-derived`, and do not change the LSP capability set.

Explicitly not implemented in V1:

- `WorkspaceEdit`.
- Write commands.
- Shell commands.
- MCP V1.1 HTTP transport.
- Raw telemetry, document content, opened document URIs, configured root paths, or raw diagnostics.
