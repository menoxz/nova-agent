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
- Provides read-only CodeLens hints for known Nova metadata.
- Provides sanitized aggregate telemetry and diagnostics summary commands.
- No file writes, shell execution, `WorkspaceEdit`, or autonomous self-rewrite.
- Raw `.nova/traces`, `.nova/evals`, `.nova/reports`, `.env`, `.git`, `node_modules`, private keys, and secret-like paths/content are denied.

## Client setup metadata

The read-only command `nova.lsp.showSetupGuide` returns safe setup metadata for common clients:

- VS Code: start the server with `npm run lsp:stdio` over stdio.
- Neovim: configure a stdio language server with root set to the Nova checkout and command `npm run lsp:stdio`.
- Validation: run `npm run lsp:smoke` and `npm run eval:lsp`.

The setup guide explicitly reports `workspaceEdit: false`, `writeCommands: false`, and `shellCommands: false` so client wiring does not accidentally grant mutating capability.

## Sanitized telemetry summary

The read-only command `nova.lsp.showTelemetrySummary` returns aggregate metadata only:

- metadata item counts by kind;
- package script, eval suite, and command counts;
- diagnostics policy booleans;
- validation commands for `lsp:smoke`, `lsp:policy-smoke`, and `eval:lsp`.

It explicitly reports `documentContentIncluded: false`, `rawDiagnosticsIncluded: false`, `uriIncluded: false`, `rootPathsIncluded: false`, and `secretsIncluded: false`. It does not expose document text, raw diagnostics, opened document URIs, configured root paths, or secret-like content.

## Sanitized diagnostics summary

The read-only command `nova.lsp.showDiagnosticsSummary` returns aggregate diagnostics/index health metadata only:

- total metadata items and package script counts;
- expected package script coverage and missing expected script names;
- duplicate metadata label count;
- non-read-only item count;
- validation commands for `lsp:policy-smoke`, `lsp:smoke`, and `eval:lsp`.

It explicitly reports `documentContentIncluded: false`, `rawDiagnosticsIncluded: false`, `uriIncluded: false`, `rootPathsIncluded: false`, and `secretsIncluded: false`. It does not expose document text, raw diagnostics arrays, opened document URIs, configured root paths, or secret-like content.

## Source-derived metadata

V1.1 derives additional MCP tool/resource/prompt metadata from `src/mcp/server.ts` registrations. These entries are tagged `source-derived` and supplement the curated baseline constants, reducing drift between the LSP metadata index and the MCP server surface.

The extraction is read-only and metadata-only: it reads the checked-in source file through the LSP policy path, does not execute MCP registration code, and does not add `WorkspaceEdit`, write, shell, or code-action capabilities. Disabled entries such as `nova_write_file` remain metadata only and are still marked non-read-only.

## Read-only CodeLens

V1.1 advertises a CodeLens provider for known Nova metadata references. CodeLens results are metadata hints only and use the existing read-only commands:

- `nova.lsp.showToolMetadata`
- `nova.lsp.showRelatedDocs`
- `nova.lsp.showEvalScenario`

CodeLens does not provide edits, code actions, shell commands, writes, or `WorkspaceEdit`.

## Markdown denied-link diagnostics

`src/lsp/diagnostics.ts` computes read-only Markdown diagnostics for denied local link targets. V1.1 inspects both inline links and reference definitions, so unsafe targets such as `[raw](../.nova/evals/report.json)` and `[raw]: ../.nova/reports/report.json` are flagged consistently on the target range.

HTTP links and same-document anchors stay outside the local denylist scope. Diagnostics do not provide code actions, quick fixes, edits, shell commands, or workspace mutations.

## Main files

- `src/lsp/server.ts` — stdio LSP entrypoint.
- `src/lsp/code_lens.ts` — read-only CodeLens metadata hints.
- `src/lsp/metadata.ts` — safe metadata index.
- `src/lsp/policy.ts` — allowlist, denylist, redaction, output caps.
- `src/lsp/telemetry.ts` — sanitized aggregate telemetry summary builder.
- `src/lsp/diagnostics_summary.ts` — sanitized aggregate diagnostics/index health summary builder.
- `src/lsp/diagnostics.ts` — diagnostics for missing scripts and sensitive artifact mentions.
- `src/lsp/smoke.ts` — protocol smoke test.
