# Nova Agent MCP Server V1

Nova exposes a local MCP stdio server for safe repository orientation and review.

MCP V1 is implemented and verified locally. The V1.1 backlog is documented in `BACKLOG_V1_1.md` for optional secure transport, automated Inspector validation, reinforced evals, gated mutating/state tools, richer curated resources, and packaging/distribution work.

## Start

```bash
cd C:\jeanluc\nova-agent
npm run mcp:stdio
# equivalent
npx tsx src/mcp/server.ts
```

Transport is stdio via `@modelcontextprotocol/sdk`. HTTP is not implemented/enabled in V1; any V1.1 HTTP/streamable transport must be opt-in, localhost-only by default, authenticated when exposed, rate-limited, and origin-restricted.

## Default posture

- Read-only by default.
- Server startup does not create project files or directories.
- `nova_bash` and `nova_write_file` are not registered by default.
- Allowed root defaults to the project root.
- Tool errors do not disclose the configured allowed-root path list.
- Curated `nova://` resources only; no raw filesystem mirror.
- Raw `.env`, `.git`, `node_modules`, private keys, and raw `.nova/traces`, `.nova/evals`, `.nova/reports` artifacts are denied.
- `nova_search_text` is literal by default; `regex: true` opts into guarded regex mode with length/ReDoS safeguards.

See `SECURITY.md`, `TOOLS.md`, `RESOURCES.md`, `PROMPTS.md`, `CLIENT_SETUP.md`, and `BACKLOG_V1_1.md`.
