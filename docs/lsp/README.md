# Nova Agent LSP V1.1

Nova LSP V1 is a stdio Language Server Protocol endpoint implemented in `src/lsp/server.ts` with the official `vscode-languageserver` and `vscode-languageserver-textdocument` packages.

V1.1 adds metadata-only client setup and policy guidance. It does not add write commands, shell commands, `WorkspaceEdit`, code actions, or autonomous self-rewrite.

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

## Client setup metadata

The read-only command `nova.lsp.showSetupGuide` returns safe setup metadata for common clients:

- VS Code: start the server with `npm run lsp:stdio` over stdio.
- Neovim: configure a stdio language server with root set to the Nova checkout and command `npm run lsp:stdio`.
- Validation: run `npm run lsp:smoke` and `npm run eval:lsp`.

The setup guide explicitly reports `workspaceEdit: false`, `writeCommands: false`, and `shellCommands: false` so client wiring does not accidentally grant mutating capability.

## Main files

- `src/lsp/server.ts` — stdio LSP entrypoint.
- `src/lsp/metadata.ts` — safe metadata index.
- `src/lsp/policy.ts` — allowlist, denylist, redaction, output caps.
- `src/lsp/diagnostics.ts` — diagnostics for missing scripts and sensitive artifact mentions.
- `src/lsp/smoke.ts` — protocol smoke test.
