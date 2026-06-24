# Nova Agent MCP Server V1.1

Nova exposes a local MCP stdio server for safe repository orientation and review.

MCP V1.1 is implemented as a safe read-only metadata/resource hardening slice. The default server remains stdio-only and local; HTTP/streamable transport remains backlog-only and must be opt-in/localhost/authenticated before any future implementation. The remaining V1.1 backlog is documented in `BACKLOG_V1_1.md` for optional secure transport, MCP Inspector automation, gated mutating/state tools, and packaging/distribution work.

## Start

```bash
cd C:\jeanluc\nova-agent
npm run mcp:stdio
# equivalent
npx tsx src/mcp/server.ts
# packaged/bin entrypoint
nova-mcp
```

Transport is stdio via `@modelcontextprotocol/sdk`. HTTP is not implemented/enabled in V1.1; any future HTTP/streamable transport must be opt-in, localhost-only by default, authenticated when exposed, rate-limited, and origin-restricted.

## Default posture

- Read-only by default.
- Server startup does not create project files or directories.
- `nova_bash` and `nova_write_file` are not registered by default.
- State tools (`nova_todo_*`, `nova_goal_*`, `nova_skill_*`) are not registered by default.
- Allowed root defaults to the project root.
- Tool errors do not disclose the configured allowed-root path list.
- Curated `nova://` resources only; no raw filesystem mirror.
- Raw `.env`, `.git`, `node_modules`, private keys, and raw `.nova/traces`, `.nova/evals`, `.nova/reports` artifacts are denied.
- `nova_search_text` is literal by default; `regex: true` opts into guarded regex mode with length/ReDoS safeguards.
- V1.1 adds curated metadata only: `nova_mcp_capabilities`, `nova://mcp/capabilities`, `nova://mcp/policy`, `nova://resources/schema-policy`, `nova://tools/schemas`, and `nova://docs/index`.
- `nova://resources/schema-policy` documents resource schema/version policy, URI stability, and resource inventory metadata for consumers.
- V1.1 observability resources (`nova://eval/recent-summary`, `nova://eval/latest-summary`, `nova://reports/latest-summary`, `nova://trace/summary`, `nova://observability/summary`) expose sanitized summaries only.
- `npm run mcp:inspect` provides repeatable Inspector-style stdio validation with metadata-only output.
- `nova-mcp` is the dedicated packaged stdio entrypoint; `npm run mcp:bin-smoke` verifies the built and linked bin path.

See `SECURITY.md`, `TOOLS.md`, `RESOURCES.md`, `PROMPTS.md`, `CLIENT_SETUP.md`, and `BACKLOG_V1_1.md`.
