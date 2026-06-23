# Project Status

## Heartbeat V3 (Slice 1) — fail-closed triple-gate execution scaffolding — 2026-06-23

Status: implemented and verified locally (offline scaffolding only; no real execution); tests passing (not yet committed).

### Delivered

- Added a pure, side-effect-free triple-gate `decideHeartbeatExecution` (`src/heartbeat/execution_gate.ts`): Gate A composes the `NOVA_ENABLE_HEARTBEAT_EXEC` master flag with the per-capability `NOVA_ENABLE_LIVE_LLM` / `NOVA_ENABLE_WRITE_TOOLS` flags against each task's needs; Gate C requires an available execution sandbox; Gate B requires an explicit granted approval. Precedence is A → C → B, and any non-`ok` task safety short-circuits to dry-run.
- Added an inert execution-sandbox seam: `src/sandbox/types.ts` (`ExecutionSandbox` interface) and `src/sandbox/probe.ts` whose `probeExecutionSandbox()` returns `null` for the entirety of ADR-002 (the real sandbox is Slice 3).
- Wired the gate into the dry-run tick at the per-task insertion point: with the master flag off the tick is byte-identical to V2 (dry-run, task stays `due`); with the master flag on and no sandbox the tick fails closed (`refused`, nothing executed, `lastRunAt` never advanced). The `execute` / `needs_user_action` outcomes remain inert scaffolding for later slices.
- Bumped the heartbeat state schema 1 → 2 (additive, forward-readable: v1 states load with the new fields `undefined` and are re-stamped `schemaVersion: 2` on next write) and widened the tick result/safety report fields and status unions to carry the new `executed` / `refused` outcomes.
- Strengthened the static guard across all `src/heartbeat/**` modules: a directory-wide sweep (12 guarded modules) asserts no module carries a spawn / timer / execute primitive (`setInterval`/`setTimeout`/`child_process`/`spawn`/`exec`/`.decide(` …), stronger than the ADR-001 single-file guard.
- Extended `src/heartbeat/smoke.ts` with the 8-row §D2 truth table, the schema v1 → v2 migration check, default-off V2 parity (SI-1), fail-closed refusal (SI-2), and the FORBIDDEN-never-execute safety invariant (SI-5).
- Placed ADR-002 (`docs/adr/ADR-002-heartbeat-v3.md`, Accepted), added the `docs/heartbeat.md` V3 note, and recorded the change in `CHANGELOG.md` `[Unreleased]`.
- Invariants preserved: package version stays `0.1.0`, no new dependency, writes stay under `.nova/` only, and no daemon / scheduler / LLM / tool / network / real execution was added.

### Verification run

- `npm run typecheck`, `npm run build`, and the offline `npm run check` gate all exit 0; `npm run heartbeat:smoke` passes (8-row truth table, Gate-A, SI-1 / SI-2 / SI-5, schema v1 → v2 migration, and the directory-wide static guard).
- See the latest implementation report for exact command output and exit codes.

## Heartbeat V2 — Planning & Automation (Phase 2) — 2026-06-23

Status: implemented and verified locally; tests passing (not yet committed).

### Delivered

- Extended Heartbeat V1 (dry-run planning ticks) with two purely consultative commands: `nova heartbeat plan` (read-only, deterministic schedule projection; default `6h` horizon / `50` max occurrences) and `nova heartbeat automation export` (operator-installable cron / systemd timer / Windows Task Scheduler manifests). No daemon, scheduler install, LLM/tool, or network call.
- Fixed BUG-1: cron `*/N` minute expressions no longer collapse — hourly cadences render as hour-band cron (e.g. `60m` ⇒ `0 */1 * * *`).
- Fixed BUG-2: Windows Task Scheduler `/MO` modifier is now emitted correctly for intervals ≥ 1440 minutes.
- Added a single consistency gate `assertRepresentableInterval`, applied identically across the cron, systemd, and Windows renderers: accepts 1–59 minutes, whole hours 60–1380, and exactly 1440; rejects non-representable intervals (90 / 1439 / 1500) uniformly with exit code 1.
- Hardened symlink jail-escape in `src/utils/safe_io.ts` (RISK-1) and made plan projection deterministic via an injected clock and a sha256 `planId` over the inputs (RISK-2).
- Added a 13-case smoke matrix to `src/heartbeat/smoke.ts`, wired into `npm run check` and `npm run check:fast`.
- Reconciled ADR-001 (`Proposed` → `Accepted / Implemented`) and recorded the shipped defaults (proposed 24 h / 10 → shipped 6 h / 50); promoted `docs/heartbeat.md` from V1 to V2 and flipped stale "V1 planning-only" strings across the heartbeat docs and ADR.
- Invariants preserved: heartbeat schema stays version 1, config stays zod `.strict()`, writes stay under `.nova/heartbeat/` only, package version stays `0.1.0`, and no new dependencies were added.

### Verification run

- `npm run typecheck`, `npm run heartbeat:smoke` (13-case interval/representability matrix), and `npm run eval:heartbeat` pass via the offline `check` gate.
- See the latest implementation report for exact command output and exit codes.

## Phase 1 — Live-LLM gate, ReAct seam & tool smokes — 2026-06-23

Status: implemented, verified, and merged to `main` (commits `dd5ed49`, `f2977ed`); CI green.

### Delivered

- Added an explicit live-LLM execution gate `NOVA_ENABLE_LIVE_LLM`; live model calls stay opt-in and disabled by default, preserving offline-by-default behaviour.
- Introduced an injectable `model?` seam so the ReAct loop can be driven by a mock model, enabling a fully offline `agent:smoke`.
- Fixed the agent/tool protocol to a single source of truth, removing the duplicated/divergent definition.
- Added `tools:smoke` covering per-tool `execute()` across the 8 read-only built-in tools.
- Fixed a grep tool bug that reported incorrect line numbers for mid-file matches.

### Verification run

- `npm run agent:smoke`, `npm run tools:smoke`, and the full `npm run check` offline gate pass; CI on `main` is green for commits `dd5ed49` and `f2977ed`.

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
