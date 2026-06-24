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

Still out of scope:

- Write commands.
- Shell commands.
- `WorkspaceEdit`.
- Autonomous self-rewrite.
- Raw sensitive artifact exposure.
- MCP V1.1 HTTP implementation.
