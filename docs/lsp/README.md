# Nova Agent LSP V1

Nova LSP V1 is a stdio Language Server Protocol endpoint implemented in `src/lsp/server.ts` with the official `vscode-languageserver` and `vscode-languageserver-textdocument` packages.

## Run

```bash
npm run lsp:stdio
npm run lsp:smoke
npm run eval:lsp
```

## Scope

- Read-only by default.
- Provides Nova metadata intelligence for package scripts, known tools/resources/prompts, documentation, eval suites/scenarios, and security policy.
- No file writes, shell execution, `WorkspaceEdit`, or autonomous self-rewrite.
- Raw `.nova/traces`, `.nova/evals`, `.nova/reports`, `.env`, `.git`, `node_modules`, private keys, and secret-like paths/content are denied.

## Main files

- `src/lsp/server.ts` — stdio LSP entrypoint.
- `src/lsp/metadata.ts` — safe metadata index.
- `src/lsp/policy.ts` — allowlist, denylist, redaction, output caps.
- `src/lsp/diagnostics.ts` — diagnostics for missing scripts and sensitive artifact mentions.
- `src/lsp/smoke.ts` — protocol smoke test.
