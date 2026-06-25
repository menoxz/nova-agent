# LSP V1.1 Backlog

Non-goals for V1 remain non-goals unless explicitly approved.

Potential V1.1 work:

- Richer metadata extraction from source registrations instead of curated constants.
- Client setup examples for VS Code/Neovim.
- More precise document-range diagnostics and code lenses, still read-only.
- Optional sanitized LSP telemetry summaries without document content.
- Unit tests around metadata and policy helpers.

Status: first safe V1.1 slice implemented for metadata-only client setup and policy guidance. The read-only `nova.lsp.showSetupGuide` command documents VS Code and Neovim stdio setup examples, `lsp:smoke` / `eval:lsp` validation commands, and explicit no-`WorkspaceEdit`, no-write, no-shell defaults. Smoke and eval coverage are reinforced without adding mutating capabilities.

Status: unit/helper validation slice implemented by `npm run lsp:policy-smoke`. It covers metadata indexing, command allowlists, no `WorkspaceEdit`/code-action/write/shell advertisement, denied write-like commands, denylist helpers, traversal/NUL refusal, redaction, output caps, safe errors, diagnostics, and setup-guide policy metadata.

Status: optional sanitized telemetry summary implemented by the read-only `nova.lsp.showTelemetrySummary` command. It exposes aggregate metadata counts and policy booleans only, explicitly omitting document content, raw diagnostics, opened document URIs, configured root paths, and secrets.

Status: richer metadata extraction implemented for MCP source registrations. The LSP metadata index now derives MCP tool/resource/prompt entries from `src/mcp/server.ts`, tags them as `source-derived`, preserves disabled/non-read-only metadata for mutating entries such as `nova_write_file`, and adds smoke/eval coverage without changing LSP capabilities.

Status: first read-only CodeLens slice implemented. The LSP advertises CodeLens metadata hints for known Nova references, using only `nova.lsp.showToolMetadata`, `nova.lsp.showRelatedDocs`, and `nova.lsp.showEvalScenario`; no edits, code actions, write commands, shell commands, or `WorkspaceEdit` are added.

Status: precise package diagnostics slice implemented. Missing expected script diagnostics now target the `scripts` object, discovered `lsp:*` scripts produce informational diagnostics on the script key, and policy smoke/eval coverage validates the ranges without adding mutating capabilities.

Status: precise duplicate metadata diagnostics slice implemented. Duplicate Nova metadata label diagnostics now target every occurrence in source/docs text, with policy smoke/eval coverage and no mutating capabilities.

Still out of scope:

- Write commands.
- Shell commands.
- `WorkspaceEdit`.
- Autonomous self-rewrite.
- Raw sensitive artifact exposure.
- MCP V1.1 HTTP implementation.
