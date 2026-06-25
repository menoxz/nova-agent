# LSP V1 Diagnostics

Diagnostics are intentionally lightweight and safe:

- Warn on missing expected scripts in `package.json`:
  - `lsp:stdio`, `lsp:smoke`, `eval:lsp`
  - existing regression guards: `mcp:stdio`, `mcp:smoke`, `eval:mcp`, `eval:smoke`, `eval:core`, `typecheck`
- Point missing-script diagnostics at the `scripts` object when present instead of the file start.
- Inform on discovered `lsp:*` package scripts and point the diagnostic at the script key.
- Flag raw artifact mentions such as `.nova/traces/*`, `.nova/evals/*`, and `.nova/reports/*`.
- Flag `.env` mentions when they look like exposed paths.
- Error on private-key or secret-like content patterns when practical.
- Inform on duplicate metadata labels discovered in the safe metadata index and point each diagnostic at the matched source/docs occurrence.

Diagnostics do not read denied raw artifacts.

V1.1 helper coverage: `npm run lsp:policy-smoke` validates these diagnostic rules against synthetic document text and also checks the underlying denylist/redaction/output-cap helpers used by the LSP metadata path.
