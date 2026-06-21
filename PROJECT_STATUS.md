# Project Status

## MCP Server V1 — 2026-06-21

Status: implemented and verified locally.

### Delivered

- Added stdio MCP server at `src/mcp/server.ts` using `@modelcontextprotocol/sdk`.
- Added package scripts `mcp:stdio` and `mcp:smoke`.
- Registered read-only `nova_*` tools for catalog, files, search, git, docs, web search, eval metadata, and sanitized trace summaries.
- Kept `nova_bash` and `nova_write_file` absent by default.
- Implemented curated `nova://` resources and required prompt templates.
- Enforced allowed-root, denylist precedence, path traversal blocking, output caps/truncation metadata, secret redaction/refusal, and safe errors.
- Hardened MCP V1 after audit: outside-root errors no longer disclose allowed-root path lists, startup no longer creates `.nova`, and text search is literal by default with guarded opt-in regex mode.
- Added MCP docs under `docs/mcp/`.
- Added MCP eval scenario/suite (`mcp-readonly-denylist`, `mcp`).
- Added MCP smoke script at `src/mcp/smoke.ts`.

### Verification run

- `npm run typecheck` — passed.
- `npm run eval:smoke` — passed 1/1.
- `npm run eval:core` — passed 3/3.
- `npm run eval:mcp` — passed 1/1.
- `npm run mcp:smoke` — passed; listed 13 tools, 10 resources, 6 prompts and verified denials.
- `npm run mcp:stdio` — starts stdio server.
- `npm audit --audit-level=high --json` — 0 high/critical vulnerabilities.

## MCP V1.1 Backlog — 2026-06-21

Status: documented; implementation not started.

### Documented scope

- Optional secure HTTP/streamable transport: opt-in only, localhost-only by default, with authentication, rate limiting, and origin-policy requirements before exposure.
- Automated MCP Inspector tests for repeatable tool/resource/prompt validation.
- Reinforced MCP evals for denylist/path traversal/outside-root/private-key/synthetic secret redaction/output caps/tool absence/resources/prompts.
- Gated roadmap for `nova_write_file`, `nova_bash`, and state tools (`nova_todo_*`, `nova_goal_*`, `nova_skill_*`) with explicit environment flags, dry-run/approval semantics, and audit logs.
- Richer curated resources for safe status, schemas, sanitized summaries, tool metadata, and docs index; raw `.nova` artifacts remain out of scope.
- Packaging/distribution notes for MCP bin entrypoint, client config examples, versioning, and release checklist.
- Acceptance criteria and explicit non-goals captured in `docs/mcp/BACKLOG_V1_1.md`.

### Current status

- MCP V1 remains the completed baseline.
- MCP V1.1 is a backlog/documentation milestone only; no MCP code changes were made for this status update.
