# LSP V1 Diagnostics

Diagnostics are intentionally lightweight and safe:

- Warn on missing expected scripts in `package.json`:
  - `lsp:stdio`, `lsp:smoke`, `eval:lsp`
  - existing regression guards: `mcp:stdio`, `mcp:smoke`, `eval:mcp`, `eval:smoke`, `eval:core`, `typecheck`
- Flag raw artifact mentions such as `.nova/traces/*`, `.nova/evals/*`, and `.nova/reports/*`.
- Flag `.env` mentions when they look like exposed paths.
- Error on private-key or secret-like content patterns when practical.
- Inform on duplicate metadata labels discovered in the safe metadata index.

Diagnostics do not read denied raw artifacts.
