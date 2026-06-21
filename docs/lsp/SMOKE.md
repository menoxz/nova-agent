# LSP Smoke Test

`npm run lsp:smoke` starts `src/lsp/server.ts --stdio` and exercises the protocol directly.

Verified checks:

- `initialize` advertises expected LSP V1 capabilities.
- `executeCommandProvider` contains only read-only Nova commands.
- No write/shell commands and no `WorkspaceEdit` are advertised.
- Opened document receives diagnostics for `.env` and raw `.nova/evals` mentions.
- Hover, completion, document symbols, workspace symbols, and read-only policy command return Nova metadata.
- `shutdown` and `exit` complete cleanly.
