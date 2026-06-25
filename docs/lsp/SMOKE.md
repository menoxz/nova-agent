# LSP Smoke Test

`npm run lsp:smoke` starts `src/lsp/server.ts --stdio` and exercises the protocol directly.

`npm run lsp:policy-smoke` exercises LSP policy and metadata helpers directly without starting a language-server process.

Verified checks:

- `initialize` advertises expected LSP V1 capabilities.
- `executeCommandProvider` contains only read-only Nova commands.
- No write/shell commands and no `WorkspaceEdit` are advertised.
- CodeLens provider is advertised and returns only read-only Nova metadata commands.
- Opened document receives diagnostics for `.env` and raw `.nova/evals` mentions.
- Package diagnostics target the `scripts` object for missing expected scripts and individual `lsp:*` keys for LSP script metadata.
- Duplicate metadata label diagnostics target every source/docs occurrence instead of only the first match.
- Hover, completion, document symbols, workspace symbols, and read-only policy command return Nova metadata.
- `nova.lsp.showSetupGuide` returns stdio-only VS Code/Neovim setup guidance and validation commands.
- `nova.lsp.showTelemetrySummary` returns aggregate metadata only and omits document content, raw diagnostics, URIs, root paths, and secrets.
- `shutdown` and `exit` complete cleanly.

Additional `lsp:policy-smoke` checks:

- Metadata index contains all read-only LSP command entries and client setup policy metadata.
- Metadata index includes source-derived MCP tool/resource/prompt entries from `src/mcp/server.ts` while preserving disabled/non-read-only flags for mutating entries.
- Capabilities remain allowlisted and do not advertise `WorkspaceEdit`, code actions, write commands, or shell commands.
- Denylist helpers refuse `.env`, `node_modules`, raw `.nova/traces|evals|reports`, private-key extensions, traversal, and NUL-byte paths.
- Redaction, output caps, safe error formatting, diagnostics, and setup-guide metadata stay deterministic and content-safe.
- Telemetry summary policy stays deterministic and metadata-only.
