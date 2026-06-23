# Project Status

## Release v0.1.0 Published + CI/CD — 2026-06-23

Status: published and tagged.

- Published `@lux-tech/nova-agent@0.1.0` to the npm public registry on 2026-06-23 (published commit `6e56e0a`).
- Created and pushed the annotated git tag `v0.1.0`; repository: https://github.com/menoxz/nova-agent.
- CI/CD now added: `.github/workflows/ci.yml` (CI — typecheck, build, and offline smoke + mock eval `check` on push to `main` and on pull requests) and `.github/workflows/release.yml` (npm publish on `v*` tags, inert until the `NPM_TOKEN` repository secret is configured).
- See `docs/release-decision-0.1.0.md` §0 (Execution record) for the full publish/tag details.

## Memory/Knowledge V1 — 2026-06-21

Status: implemented locally.

### Documented scope

- Added complete Memory/Knowledge V1 documentation under `docs/memory/` covering architecture, persistence, security, retrieval, lifecycle, eval acceptance, and V1.1 backlog.
- Defined memory types: semantic, episodic, procedural, profile, decision, and finding.
- Defined scoped local persistence under `.nova/memory` with `_index.json`, item files, collections, archive, import/export, schema versioning, migrations, hashes/fingerprints, atomic writes, and index rebuild.
- Defined retrieval and write policies with profile/policy gates, untrusted context wrapper, token budget, stale handling, secret scanning, raw artifact rejection, redaction, approval, and metadata-only audit.
- Captured integrations with Agent Profiles, NovaAgent, Subagents, Policy/Permissions, Trace/Eval, and future MCP/LSP.

### Delivered

- Added `src/memory/` V1 module for scoped local JSON persistence under `.nova/memory`, schema validation, atomic writes, rebuildable metadata index, audit JSONL, lifecycle/archive, safe import/export, policy-gated retrieval/write, redaction, and smoke coverage.
- Preserved `ConversationMemory` while adding optional long-term memory prompt injection through an untrusted bounded context block.
- Integrated memory metadata with AgentConfig/Profile resolution, trace/eval summaries, and subagent report memory proposals without auto-persisting subagent findings.
- Added `memory:smoke` and `eval:memory` scripts and memory eval suite.

### Verification run

- See latest implementation report for exact command output and exit codes.

## Agent Profiles V1 — 2026-06-21

Status: implemented locally.

### Delivered

- Added `src/profiles/` foundation module with schema, validation, defaults, catalogue, loading, resolving, migration, import/export, hashing, audit metadata, security checks, smoke test, and exports.
- Added nine built-ins: `nova.general`, `nova.researcher`, `nova.architect`, `nova.builder`, `nova.security`, `nova.qa`, `nova.docs`, `nova.refactor`, and `nova.product`.
- Extended `AgentConfig`, trace run-start config, eval reports, and subagent roles/workers with profile metadata and profile resolution.
- Added CLI/eval support for `--profile`/`NOVA_PROFILE`, profile-gated tool constraints, and `profiles:smoke` / `eval:profiles` scripts.
- Added profile docs under `docs/profiles/`.

### Verification run

- See latest implementation report for exact command output and exit codes.

## Sub-agent Orchestration V1 — 2026-06-21

Status: implemented locally.

### Delivered

- Added `src/subagents/` module for bounded delegated workers: roles, registry, contracts, delegation, DAG task graph, context caps/redaction, budgets, worker wrapper, orchestrator, sanitized lifecycle trace, smoke test, and exports.
- Added required roles: researcher, architect, builder, reviewer, security, qa, docs, refactor.
- Enforced effective authority as parent grant ∩ role default ∩ policy profile, with no default write/shell grants and no recursive spawning in V1.
- Propagated `ActorContext` and `DelegationContext` through `AgentConfig.policy`, `ToolRegistry`, and worker tool execution.
- Extended policy child-escalation checks to include delegated resources/paths.
- Added `subagents:smoke`, `eval:subagents`, and docs under `docs/subagents/`.

### Verification run

- See latest implementation report for exact command output and exit codes.

## Policy/Permissions V1 — 2026-06-21

Status: implemented and verified locally.

### Delivered

- Added shared policy core under `src/policy/` with types, profiles, deterministic rules, path helpers, redaction, output caps, safe errors, and metadata-only audit events.
- Integrated Sub-agent Contract Spec V0 fields in types only; no full sub-agent orchestration added.
- Added optional ToolRegistry pre-execution policy hook; deny/ask blocks execution unless an approval integration explicitly approves.
- Added tool metadata for capability/readOnly/riskLevel across built-in tools.
- Harmonized trace redaction and reused shared path/redaction/output helpers in LSP/MCP where safe while preserving read-only defaults.
- Added `policy:smoke` and `eval:policy`, plus policy documentation.

### Verification run

- See latest implementation report for exact command output and exit codes.

## LSP Server V1 — 2026-06-21

Status: implemented and verified locally.

### Delivered

- Added stdio LSP server at `src/lsp/server.ts` using official VS Code LSP packages.
- Added package scripts `lsp:stdio`, `lsp:smoke`, and `eval:lsp`.
- Implemented read-only capabilities: lifecycle, text sync, diagnostics, hover, completion, document symbols, workspace symbols, and metadata-only commands.
- Indexed safe Nova metadata from package scripts, known tools/resources/prompts, docs, eval suites/scenarios, and policy notes.
- Enforced LSP allowlist/denylist, redaction, output caps, safe errors, and no `WorkspaceEdit`/write/shell commands.
- Added LSP docs under `docs/lsp/` and LSP eval scenario/suite.

### Verification run

- `npm run typecheck` — passed.
- `npm run lsp:smoke` — passed.
- `npm run eval:lsp` — passed 1/1.
- Full regression verification recorded in the implementation report.

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
