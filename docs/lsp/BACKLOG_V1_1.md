# LSP V1.1 Backlog

Non-goals for V1 remain non-goals unless explicitly approved.

Potential V1.1 work:

- Richer metadata extraction from source registrations instead of curated constants.
- Client setup examples for VS Code/Neovim.
- More precise document-range diagnostics and code lenses, still read-only.
- Optional sanitized LSP telemetry summaries without document content.
- Unit tests around metadata and policy helpers.

Status: first safe V1.1 slice implemented for metadata-only client setup and policy guidance. The read-only `nova.lsp.showSetupGuide` command documents VS Code and Neovim stdio setup examples, `lsp:smoke` / `eval:lsp` validation commands, and explicit no-`WorkspaceEdit`, no-write, no-shell defaults. Smoke and eval coverage are reinforced without adding mutating capabilities.

Still out of scope:

- Write commands.
- Shell commands.
- `WorkspaceEdit`.
- Autonomous self-rewrite.
- Raw sensitive artifact exposure.
- MCP V1.1 HTTP implementation.
