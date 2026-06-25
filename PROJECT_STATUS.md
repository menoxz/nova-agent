# Project Status

## LSP V1.1 precise package diagnostics — 2026-06-25

Status: implemented locally (diagnostics only; no code actions, edits, write/shell, or WorkspaceEdit capability); targeted and full validation passing locally.

### Delivered

- Missing expected `package.json` script diagnostics now target the `scripts` object when present instead of the file start.
- Discovered `lsp:*` package scripts produce informational diagnostics on the exact script key.
- Added policy-smoke assertions for diagnostic ranges on synthetic package.json content.
- Expanded `eval:lsp` with `lsp-v1-1-precise-package-diagnostics`.
- Updated LSP diagnostics/smoke docs, V1.1 backlog, roadmap, changelog, and project status.

### Verification run

- `npm run typecheck`, `npm run lsp:policy-smoke`, `npm run lsp:smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## LSP V1.1 read-only CodeLens metadata surface — 2026-06-25

Status: implemented locally (metadata hints only; no code actions, edits, write/shell, or WorkspaceEdit capability); targeted and full validation passing locally.

### Delivered

- Added `src/lsp/code_lens.ts` with read-only CodeLens generation for known Nova metadata references.
- LSP capabilities now advertise `codeLensProvider` with `resolveProvider: false`.
- CodeLens commands are limited to existing read-only commands: `nova.lsp.showToolMetadata`, `nova.lsp.showRelatedDocs`, and `nova.lsp.showEvalScenario`.
- CodeLens data is marked `readOnly: true` and does not provide edits/actions.
- Reinforced `lsp:smoke`, `lsp:policy-smoke`, and `eval:lsp` coverage.
- Updated LSP README, capabilities, smoke docs, V1.1 backlog, roadmap, changelog, and project status.

### Verification run

- `npm run typecheck`, `npm run lsp:smoke`, `npm run lsp:policy-smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## LSP V1.1 source-derived metadata extraction — 2026-06-24

Status: implemented locally (read-only source parsing only; no MCP execution; no write/shell/WorkspaceEdit/code-action capability); targeted and full validation passing locally.

### Delivered

- Added source-derived MCP tool/resource/prompt metadata extraction from `src/mcp/server.ts` in the LSP metadata index.
- Source-derived entries are tagged `source-derived` and keep their source path as `src/mcp/server.ts`.
- Disabled/mutating MCP entries such as `nova_write_file` remain metadata-only and are marked non-read-only.
- Reinforced `lsp:policy-smoke` and `eval:lsp` coverage for source-derived MCP tool/resource/prompt metadata.
- Updated LSP README, capabilities, smoke docs, V1.1 backlog, roadmap, changelog, and project status.

### Verification run

- `npm run typecheck`, `npm run lsp:policy-smoke`, `npm run lsp:smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## LSP V1.1 sanitized telemetry summary — 2026-06-24

Status: implemented locally (aggregate metadata only; no document content, raw diagnostics, URIs, root paths, or secrets; no write/shell/WorkspaceEdit/code-action capability); targeted and full validation passing locally.

### Delivered

- Added `src/lsp/telemetry.ts` with `buildLspTelemetrySummary()`.
- Added read-only command `nova.lsp.showTelemetrySummary`.
- Summary reports metadata counts, diagnostics policy booleans, stdio/no-mutating-capability posture, and validation commands.
- Summary explicitly reports `documentContentIncluded: false`, `rawDiagnosticsIncluded: false`, `uriIncluded: false`, `rootPathsIncluded: false`, and `secretsIncluded: false`.
- Reinforced `lsp:smoke`, `lsp:policy-smoke`, and `eval:lsp` coverage.
- Updated LSP README, capabilities, smoke docs, V1.1 backlog, roadmap, changelog, and project status.

### Verification run

- `npm run typecheck`, `npm run lsp:smoke`, `npm run lsp:policy-smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## LSP V1.1 policy/metadata helper smoke — 2026-06-24

Status: implemented locally (helper-level validation only; stdio/read-only posture preserved; no write/shell/WorkspaceEdit/code-action capability); targeted and full validation passing locally.

### Delivered

- Added `npm run lsp:policy-smoke` backed by `src/lsp/policy_smoke.ts`.
- Covers LSP metadata indexing, read-only command allowlist, capability safety, denied write-like commands, denylist helpers, traversal/NUL refusal, redaction, output caps, safe errors, diagnostics, and setup-guide policy metadata.
- Wired `lsp:policy-smoke` into `check:fast` and `check`.
- Expanded `eval:lsp` with `lsp-v1-1-policy-metadata-helper-smoke`.
- Updated LSP smoke/capabilities/diagnostics docs, V1.1 backlog, roadmap, changelog, and project status.

### Verification run

- `npm run typecheck`, `npm run lsp:policy-smoke`, `npm run lsp:smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## LSP V1.1 client setup policy metadata — 2026-06-24

Status: implemented locally (metadata-only client setup/policy guidance; stdio/read-only posture preserved; no write/shell/WorkspaceEdit/code-action capability); targeted and full validation passing locally.

### Delivered

- Added read-only command `nova.lsp.showSetupGuide` to return VS Code and Neovim stdio setup examples.
- Setup metadata documents validation with `npm run lsp:smoke` and `npm run eval:lsp`.
- Setup metadata explicitly reports `workspaceEdit: false`, `writeCommands: false`, and `shellCommands: false`.
- Added LSP policy metadata item for V1.1 client setup and reinforced LSP smoke/eval coverage.
- Wired `lsp:smoke` and `eval:lsp` into the default `npm run check`; `lsp:smoke` is also included in `check:fast`.
- Updated LSP README, V1.1 backlog, roadmap, and changelog.

### Verification run

- `npm run typecheck`, `npm run lsp:smoke`, and `npm run eval:lsp` exit 0.
- `npm run build && npm run check` exits 0.

## MCP V1.1 transport readiness policy — 2026-06-24

Status: implemented (metadata-only readiness policy; no HTTP/streamable implementation; no listener, port, or bind; read-only stdio posture preserved); targeted and full validation passed locally before commit.

### Delivered

- Added generated resource `nova://mcp/transport-readiness` documenting current stdio-only transport posture and future optional HTTP/streamable requirements.
- Confirmed in metadata that `activeTransport` is `stdio`, HTTP and streamable HTTP are disabled/not implemented, no listener is created, no port is opened, and public bind is not allowed by default.
- Documented readiness requirements for any future network transport: explicit opt-in, localhost-only bind by default, no `0.0.0.0` without a separate public-bind flag, authentication for non-local/browser deployment, strict origin allowlist, rate limiting, safe diagnostics, and preservation of allowed-root/denylist/redaction/output-cap/resource/prompt/tool-registration policies.
- Reinforced `mcp:smoke`, `mcp:inspect`, and `eval:mcp` coverage for the transport readiness resource and no-network invariants.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, and `npm run eval:mcp` exit 0.
- `npm run build && npm run check` exits 0.

## MCP V1.1 gated mutating/state tools policy — 2026-06-24

Status: implemented locally (metadata-only roadmap; no mutating/state tool registration; no HTTP transport; read-only stdio posture preserved); tests passing locally (not yet committed).

### Delivered

- Added generated resource `nova://mcp/gated-tools-policy` documenting candidate future tool families: `nova_bash`, `nova_write_file`, and state tools (`nova_todo_*`, `nova_goal_*`, `nova_skill_*`).
- Documented explicit future activation gates (`NOVA_MCP_ENABLE_BASH=1`, `NOVA_MCP_ENABLE_WRITE_FILE=1`, `NOVA_MCP_ENABLE_STATE_TOOLS=1`) plus required dry-run previews, approval semantics, redacted audit logging, denylist/allowed-root enforcement, output caps, and validation coverage.
- Confirmed in metadata that mutating/state tools remain absent by default and no write/shell/state action is implemented in this slice.
- Reinforced `mcp:smoke`, `mcp:inspect`, and `eval:mcp` coverage for the policy resource and forbidden-tool absence.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 release readiness and compatibility resources — 2026-06-24

Status: implemented locally (metadata-only MCP resources plus package-manifest readiness checks; no publish/tag/release; no HTTP transport; mutating/state tools remain absent by default); tests passing locally (not yet committed).

### Delivered

- Added generated resources `nova://mcp/release-checklist` and `nova://mcp/compatibility` for MCP packaging consumers.
- Release checklist metadata includes required local validation commands, package manifest safety expectations, no-publish/no-tag/no-release non-goals, and invariants keeping HTTP/streamable transport, mutating tools, raw `.nova`, secrets, and configured root disclosure absent.
- Compatibility metadata documents Node.js 22.x, `@modelcontextprotocol/sdk ^1.29.0`, `nova-mcp` stdio entrypoints, unsupported-by-default HTTP/streamable/mutating/state surfaces, and versioning metadata.
- Strengthened `npm run release:readiness` to require the MCP stdio bin and MCP docs in the npm manifest; added `docs/mcp/BACKLOG_V1_1.md` to package files.
- Reinforced `mcp:smoke`, `mcp:inspect`, and `eval:mcp` coverage for the new resources.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run eval:mcp`, `npm run build`, `npm run check`, and `npm run release:readiness` exit 0.

## MCP V1.1 resource schema/versioning policy — 2026-06-24

Status: implemented locally (curated resource metadata only; no raw `.nova` content; no HTTP transport; mutating/state tools remain absent by default); tests passing locally (not yet committed).

### Delivered

- Added generated resource `nova://resources/schema-policy` with package version `0.1.0`, MCP behavior version `1.1`, `resourceSchemaVersion: 1`, `resourcePolicyVersion: 1`, URI stability rules, behavior/schema/policy bump rules, safety invariants, and a full curated resource inventory.
- Added resource schema/version metadata to generated MCP capabilities/policy resources, `nova://eval/schema`, and observability JSON resources.
- Kept resource URI behavior additive and stable; existing resources remain curated and read-only with no raw filesystem mirror.
- Reinforced `mcp:smoke`, `mcp:inspect`, and `eval:mcp` coverage for schema-policy presence, inventory/version consistency, and safety invariants.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 sanitized observability resources — 2026-06-24

Status: implemented locally (read-only generated MCP resources; no raw `.nova` content; no HTTP transport; mutating/state tools remain absent by default); tests passing locally (not yet committed).

### Delivered

- Added generated resources `nova://eval/recent-summary`, `nova://eval/latest-summary`, `nova://reports/latest-summary`, `nova://trace/summary`, and `nova://observability/summary`.
- Each resource declares a sanitization policy and exposes summary metadata only: counters, statuses, run IDs, timestamps, gates, failed scenario names/check names, and aggregate trace/eval metrics.
- Sanitization omits raw report paths, configured root paths, raw `.nova` eval/trace/report contents, raw trace events/content, and secret-like strings. Missing observability artifacts return safe unavailable summaries rather than raw errors.
- Reinforced `mcp:smoke`, `mcp:inspect`, and `eval:mcp` coverage for the new observability resources.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run mcp:bin-smoke`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 reinforced evals slice — 2026-06-24

Status: implemented locally (mock eval coverage only; no HTTP transport; read-only posture preserved; mutating/state tools remain absent by default); tests passing locally (not yet committed).

### Delivered

- Expanded `eval:mcp` from 2 to 5 mock scenarios: baseline read-only denylist, V1.1 curated metadata/resources, path denial matrix, redaction/output caps, and disabled-tools/curated-surface checks.
- Added explicit eval coverage expectations for `.env`, `.env.*`, `.git`, `node_modules`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, traversal, NUL-byte paths, outside-root denial without root disclosure, private-key extension/content refusal, synthetic secret redaction, output caps/truncation metadata, absent mutating/state tools, curated resources/prompts, stdio default, and HTTP transport remaining off.
- Kept the slice eval-only: no server transport change, no mutating/state tool registration, no package version bump, and no new dependencies.
- Documented the reinforced eval coverage in the MCP backlog/status/changelog.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run mcp:bin-smoke`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 packaging/client setup slice — 2026-06-24

Status: implemented locally (dedicated packaged stdio entrypoint; no HTTP transport; read-only posture preserved; mutating/state tools remain absent by default); tests passing locally (not yet committed).

### Delivered

- Added `bin/nova-mcp.js` and the package bin `nova-mcp`, separate from the interactive `nova` CLI. The wrapper starts `dist/mcp/server.js` after build and falls back to `src/mcp/server.ts` through `tsx` in dev.
- Kept the entrypoint stdio-only and metadata-safe: `--help`/`--version` are the only accepted arguments, unsupported args exit 2, and the entrypoint does not enable HTTP/streamable transport or mutating/state tools.
- Added `src/mcp/bin_smoke.ts` and `npm run mcp:bin-smoke`, covering help/version, unsupported-arg refusal, built MCP stdio handshake, disabled tool absence, V1.1 resource visibility, and linked-package `nova-mcp` usage.
- Wired `mcp:bin-smoke` into `check` and `check:fast`; packaged files now include MCP docs needed for installed client setup.
- Updated MCP client setup and packaging docs with checkout, installed/linked, npm-exec, and Windows-path client config examples.

### Verification run

- `npm run typecheck`, `npm run mcp:bin-smoke`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run bin:smoke`, `npm pack --dry-run --ignore-scripts`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 Inspector-style stdio validation — 2026-06-24

Status: implemented and committed locally (not yet pushed; stdio-only validation; read-only posture preserved; mutating/state tools remain absent by default); tests passing locally.

### Delivered

- Added `src/mcp/inspector_validate.ts` and the `npm run mcp:inspect` script. The validator starts the local MCP server over stdio with a synthetic temporary allowed root, mirroring manual Inspector checks without opening network transport.
- Coverage includes tool/resource/prompt listing, `nova_mcp_capabilities`, curated V1.1 resources, prompt retrieval, safe read metadata, representative denied reads, synthetic secret redaction, literal search default, regex opt-in, and regex guardrails.
- Output is pass/fail metadata only: no report file is written, no configured root paths are printed, no raw `.nova` artifacts are read or emitted, and no secrets/private-key fixtures are exposed.
- Wired `mcp:inspect` into `npm run check` and documented local usage in MCP client/setup docs and backlog status.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run mcp:inspect`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0.

## MCP V1.1 curated metadata/resources slice — 2026-06-24

Status: implemented, committed, and pushed to `main` (stdio remains the only/default transport; read-only posture preserved; mutating/state tools remain absent by default); local tests and CI passing.

### Delivered

- Added the read-only `nova_mcp_capabilities` tool. It summarizes MCP version, stdio transport posture, output/file/search caps, resource/prompts inventory, and disabled tool families without disclosing configured allowed-root paths.
- Added curated generated resources: `nova://mcp/capabilities`, `nova://mcp/policy`, `nova://tools/schemas`, and `nova://docs/index`. These expose safe metadata only: limits, denylist/redaction policy, tool registration/input summaries, and high-value docs pointers.
- Reinforced MCP verification: `mcp:smoke` now asserts the V1.1 tool/resource surface, reads the generated resources, checks disabled `nova_bash`/`nova_write_file`, and keeps root paths undisclosed. `eval:mcp` now covers both the original read-only denylist scenario and a new V1.1 curated metadata/resources scenario.
- Updated MCP docs (`README`, `TOOLS`, `RESOURCES`, `BACKLOG_V1_1`) to record the implemented V1.1 slice and explicitly keep HTTP/streamable transport and mutating/state tools out of scope/defaults.
- Invariants preserved: package `0.1.0`; zero new dependencies; no network transport enabled; no `nova_bash`, `nova_write_file`, or state tools registered by default; raw `.nova` artifacts remain denied.

### Verification run

- `npm run typecheck`, `npm run mcp:smoke`, `npm run eval:mcp`, `npm run build`, and `npm run check` exit 0; CI run `28111974020` passes on pushed commit `116b900`.

## Sandboxed BashTool V1 — opt-in ExecutionSandbox routing — 2026-06-24

Status: implemented locally (legacy behaviour preserved by default; sandboxed path opt-in via `NOVA_ENABLE_EXEC_SANDBOX=1|true`); tests passing locally (not yet committed).

### Delivered

- Routed the existing mutating `bash` tool through the hardened `ExecutionSandbox` when the sandbox opt-in flag is enabled. Default behaviour remains the legacy shell runner, preserving compatibility unless the operator explicitly opts in.
- Preserved existing bash guardrails: timeout/output caps, interactive/long-running command refusal, workdir validation, and process-tree cleanup semantics. The sandboxed path reuses the sandbox env allow-list, cwd jail, protected loader vars, truncation/timeout handling, and fail-closed probe semantics.
- Added a `bash:smoke` gate and wired it into `check`/`check:fast`. Coverage: default legacy mode and output, sandbox opt-in marker, caller env allow-list addition without leaking a synthetic secret, protected `PATH` non-override, and stdin refusal because the sandbox contract does not support stdin.
- Invariants preserved: package `0.1.0`; zero new dependencies; no daemon/timers; Heartbeat V3 unchanged except via shared sandbox usage; sandbox remains opt-in and fail-closed.

### Verification run

- `npm run typecheck` and `npm run bash:smoke` exit 0; full build/check verification recorded in the implementation run.

## Heartbeat V3 (Slice 5) — operator decision surface (run-scoped, fail-closed, no-bypass) — 2026-06-24

Status: implemented and verified locally (offline `check` green; `decide` is an explicit human command only, never called by the autonomous tick; default-off behaviour remains byte-identical to V2); tests passing (not yet committed).

### Delivered

- Added `nova heartbeat decide <taskId> (--approve|--deny|--review) [--reason <text>]` to close the S4b operator loop. The command reads the heartbeat ledger, requires exactly one operator action, validates the S4b composite locator (`pendingSessionId` + `pendingSessionRunId` + `pendingSessionApprovalId`), and fails closed on absent, partial, or expired pending state before any session decision can be made.
- Confined all session-decision I/O to a new out-of-tree adapter, `src/autoexec/decision_applier.ts`. The adapter constructs `SessionRunManager` only and calls the run-scoped `decideApproval(sessionId, runId, approvalId, decision, { decidedBy:'heartbeat-operator', reason })`; it never uses `ApprovalManager.decide` or any bare approval-id decision. It discards the returned `RunRecord` and returns only plain data.
- Bound the Slice 5 security re-audit before build. **B1/C5** review and confirmation output are explicit allow-list projections (no state spread, no session locator, no command/env/secret/reason); **C1** the heartbeat static guard now rejects both `.decide(` and `.decideApproval(` in guarded modules; **C2** the applier is SessionRunManager-only; **C3** expiry uses `isHeartbeatApprovalExpired(task.pendingApprovalAt, now)`; **C4** exact throw-prefix mapping returns `unknown_run` / `unknown_approval` / `not_pending` / `io_error`; **C5** success prints only `taskId` + `status`.
- Preserved no-bypass semantics: `decide` never mutates `.nova/heartbeat/state.json` and never executes work. Approve/deny only update the underlying session approval; the next externally invoked tick still resolves Gate B through the S4b gateway and rechecks Gate A, Gate C, TTL, precedence, and single-use clearing.
- Offline smokes added. `src/heartbeat/smoke.ts`: approve and deny exact-tuple forwarding through a fake applier, absent/partial/expired fail-closed with zero applier calls, anti-leak review and confirmation sentinels, safe error surfacing, state byte-unchanged no-bypass, master-off parity, and a guard-injection fixture. `src/autoexec/smoke.ts`: applier static checks, real temporary-session approve/deny round-trips, plain-data outcomes, and exact error-prefix mapping.
- Invariants preserved: package `0.1.0`; heartbeat schema `3`; zero new dependencies; no daemon/timers; `src/sandbox/**` untouched; live paths remain opt-in/out of `check`; `src/heartbeat/**` imports no `../session/` or `../tools/` in production modules, and the decision applier is the sole production holder of `decideApproval`.

### Verification run

- `npm run typecheck`, `npm run build`, and the offline `npm run check` gate exit 0 (independently re-run by the orchestrator). `heartbeat:smoke` passes the Slice 5 fail-closed/no-leak/no-bypass/static-guard scenarios; `autoexec:smoke` passes the decision-applier round-trip/static/error-mapping scenarios and correctly skips live work.

## Heartbeat V3 (Slice 4b) — the session-namespace approval bridge (CAVEAT-6 re-audited, fail-closed, opt-in) — 2026-06-24

Status: implemented and verified locally (offline `check` green; the bridge is **off by default** — when the master flag is off it is never constructed, no `.nova/sessions/` I/O happens, and the tick stays byte-identical to V2; row 8 reachable in production **only** under A∧B∧C **with a real session approval**); tests passing (not yet committed).

### Delivered

- Built the `hb-appr-<uuid>` (heartbeat ledger) ↔ `approval_<N>` (session manager) namespace bridge deferred by Slice 4. Added two type-level ports to `src/heartbeat/**`: `HeartbeatApprovalRequester.request(req)` (secret-free `{taskId, kind, capability:'shell'}` request; mints a session approval, returns its **composite locator**) and the existing `HeartbeatApprovalGateway.resolve` **widened** to `resolve(approvalId, locator?)` (back-compatible; the production stub still ignores the locator and returns `'pending'`). A decided session approval now drives Gate B to `'approved'`; absent/undecided ⇒ `'pending'`/refused (fail-closed).
- Confined all `.nova/sessions/` I/O to a new module **outside** the swept heartbeat tree: `src/autoexec/approval_gateway.ts` (`createHeartbeatApprovalBridge({ projectRoot })`), the sole holder of session-API access; it builds `SessionRunManager`/`ApprovalManager` internally. The CLI composition root (`src/heartbeat/index.ts`) imports **only** this plain-data factory (B3), so no `../session/` or `../tools/` import ever enters `src/heartbeat/**` and the static-guard import-denylist stays intact. The requester **never** calls `.decide(` (source-guarded).
- Bound the read-only security re-audit (BLOCKERS-FIRST: 4 blockers + 9 caveats) into the design **before** implementation: **B1** every port call is try/catch-wrapped at the trust boundary (`resolve` throw ⇒ `'pending'`; `request` throw/`undefined` ⇒ synthetic-only mint) so a store error can never unwind `runner.ts` `Promise.all` and skip `writeState` (SI-9); **B2** because `approval_<N>` is per-run non-unique, a **composite unique locator** (`pendingSessionId`+`pendingSessionRunId`+`pendingSessionApprovalId`) is persisted to `.nova/heartbeat/state.json` and the gateway matches the **full** `(sessionId, runId, approvalId)` tuple, so a different run's `approval_1` can never open Gate B; **B3** plain-data factory import; **B4** the approval is recorded `capability:'shell'` (`'heartbeat-exec'` is not a `CapabilityCategory`).
- Offline smokes added. `src/heartbeat/smoke.ts`: locator-persistence mint, B1 throwing requester ⇒ synthetic-only mint (executes nothing) and throwing gateway ⇒ tick still completes / never auto-grants / **retains** the locator, B2 wrong-run locator ⇒ `'pending'`, C5 anti-leak sentinel (session ids **absent from the redacted report, present in `state.json`**), B4 `capability:'shell'` pin, TTL-skew expiry ⇒ never `'approved'`, master-off parity (no mint). `src/autoexec/smoke.ts`: full bridge round-trip over a shared store, B2 two-run `approval_1` disambiguation, C5/C8 denied-reason redaction, and a `.decide(`-absent source guard. An opt-in offline real-sandbox bridge run (`node --version` end-to-end) is kept out of `check`.
- Schema bumped `2 → 3` (additive, parity scoped to report/tick with the `version` int exempted). Documented in ADR-002 §16 addendum.
- Invariants preserved: package `0.1.0`; zero new dependencies; no daemon/timers; `src/sandbox/**` untouched; heartbeat static guard green; writes confined to `.nova/heartbeat/` (every `.nova/sessions/` access via the session API in `src/autoexec/**`); default-off behaviour byte-identical to V2; no bypass, gate precedence intact.

### Verification run

- `npm run typecheck`, `npm run build`, and the offline `npm run check` gate all exit 0 (independently re-run by the orchestrator before commit); `npm run heartbeat:smoke` passes (guard + Slice 4b offline scenarios); `npm run autoexec:smoke` passes offline (bridge round-trip + B2 two-run + C5/C8 + no-decide guard) and correctly skips the live path. Confinement re-checked: no `../session/`/`../tools/` import in `src/heartbeat/**`; heartbeat writes only `.nova/heartbeat/`; bridge requester carries zero `.decide(`.

## Heartbeat V3 (Slice 4) — real delegated execution wired behind the triple-gate (fail-closed, opt-in) — 2026-06-24

Status: implemented and verified locally (offline `check` green; the real execution path is **off by default** and reachable only under A∧B∧C; production Gate B stays `'pending'` so row 8 is unreachable in production — double fail-closed); tests passing (not yet committed).

### Delivered

- Replaced the executor `execute`-branch stub (`executor.ts:135-142`, which fabricated `executed` without running anything) with a real delegated run. Added the injectable port `HeartbeatExecutionCapability.run(req)` (secret-free `{taskId, kind}` request, metadata-only `{ok, summary, exitCode?, durationMs?}` outcome), threaded `capability?` through `runner.ts` into `evaluateHeartbeatExecution`; row 8 now calls `resolveDelegatedExecution`.
- §D9 trust boundary enforced: **no capability ⇒ `refused` (grant RETAINED, R1)**; **throw/reject ⇒ `refused` (grant CONSUMED, caught — never propagates out of the tick, R3)**; **`ok:false` ⇒ `refused` (CONSUMED)**; **`ok:true` ⇒ `executed` (CONSUMED)**. The `summary` surfaces **only** via the redacted `result.reason` — no new field on result/report/state (BLOCKER-2/SI-8).
- Added the production wiring **outside** the swept heartbeat tree: `src/autoexec/capability.ts` (`createDelegatedExecutionCapability`) composes `ToolRegistry.toAITools({ policy… })` + `ExecutionSandbox.run` (S3, unmodified) with producer-side redaction dropping stdout/stderr bodies (CAVEAT-5). Added `src/autoexec/smoke.ts` (offline unit in `check` as `autoexec:smoke`; opt-in real e2e `autoexec:live-smoke --live`, out of `check`).
- Offline smokes added to `src/heartbeat/smoke.ts`: whole-report byte-identical parity under master-off (SI-1), capability-absent⇒refused, throw⇒refused (secret absent from `JSON.stringify(tick)`), `ok:false`⇒refused, success⇒executed (summary secret redacted from full tick), `registry.toAITools` policy-composition. Static guard hardened (CAVEAT-1): import-denylist on `tools`/`session` and sandbox-only-via-`probe.js`.
- Scope is **mechanism-only**: the `hb-appr-<uuid>` ↔ `approval_<N>` session bridge is **deferred to Slice 4b**.
- Invariants preserved: package `0.1.0`; zero new dependencies; no daemon/timers; `src/sandbox/**` untouched; heartbeat static guard green; writes confined to `.nova/heartbeat/`; default-off behaviour byte-identical to V2.

### Verification run

- `npm run typecheck` and the offline `npm run check` gate exit 0 (eval 100%, gates passed); `npm run heartbeat:smoke` passes (guard + Slice 4 offline scenarios); `npm run autoexec:smoke` passes offline and correctly skips the live path; `NOVA`-gated `npm run autoexec:live-smoke` passes the real `node --version` end-to-end run. Independently re-run by the orchestrator before commit.

## Heartbeat V3 (Slice 3) — real hardened execution sandbox (capability-only, opt-in) — 2026-06-24

Status: implemented and verified locally (offline; the sandbox is a **capability only** — no caller in `src/heartbeat/**` invokes `run()`, so the heartbeat still fails closed unless explicitly opted in; tests passing (not yet committed).

### Delivered

- Added the real hardened-subprocess sandbox `src/sandbox/sandbox.ts` (`createExecutionSandbox()`), replacing the Slice-1 stub behaviour. It spawns a single command **shell-free** (`shell:false`, so metacharacters are never interpreted), builds the child environment from a per-platform **allow-list only** (never `...process.env`), jails `cwd` under `PROJECT_ROOT` via `assertPathUnderDir` + `deniedPathReason`, enforces a deterministic wall-clock timeout and a combined stdout/stderr truncation budget (both force `exitCode: null`), and tears down the process tree (`taskkill /T /F` on Windows, detached process-group signals on POSIX). Constructing it spawns nothing; the first process is created only on `run()`.
- Added the platform gate `src/sandbox/platform.ts` (`sandboxIsSupportedPlatform()`), so unsupported platforms keep Gate C closed.
- Flipped `src/sandbox/probe.ts` from the always-`null` stub to **strict opt-in**: `probeExecutionSandbox(env = process.env)` returns a live sandbox only when `NOVA_ENABLE_EXEC_SANDBOX` is strictly enabled (`"1"`/`"true"`, reusing `isHeartbeatFlagEnabled` — **SB1**) **and** the platform is supported; otherwise `null` (Gate C closed ⇒ fail-closed). The optional `env` parameter keeps the existing `runner.ts` call site (`probeExecutionSandbox()?.available`) unchanged.
- Security blocker **SB2** enforced in `buildChildEnv`: caller-supplied env may *add* vars but can never override the base loader-resolution vars (`PATH`, plus `SystemRoot`/`COMSPEC`/`PATHEXT` on Windows), and loader-injection vars (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `NODE_OPTIONS`, `DYLD_*`) are dropped; invalid names / non-string / oversized / NUL-bearing entries are dropped; the child env uses a null prototype so a `__proto__` key cannot pollute the chain.
- Added the isolated smoke `src/sandbox/smoke.ts` (9 tests: env allow-list leak via real spawn, caller deny-list + proto-pollution guard, PATH non-override, timeout, truncation, cwd jail accept/reject, shell-free arg passing, `clampNumber`, probe opt-in) and wired `sandbox:smoke` into both `check` and `check:fast` (after `heartbeat:smoke`).
- Invariants preserved: **capability-only** — `ExecutionSandbox.run()` has **zero callers** in `src/heartbeat/**` (runner reads only `.available`); all spawn/timer primitives live under `src/sandbox/**`, so the heartbeat static guard (still sweeping its 13 modules) is untouched; the executor execute branch is unchanged; package version stays `0.1.0`; no new dependency (node builtins only).

### Verification run

- `npm run typecheck` and the offline `npm run check` gate exit 0; `npm run sandbox:smoke` passes 9/9 and `npm run heartbeat:smoke` still passes (guard intact), fully offline.
- See the latest implementation report for exact command output and exit codes.

## Heartbeat V3 (Slice 2) — cross-tick approval lifecycle (OFFLINE) — 2026-06-23

Status: implemented and verified locally (offline; production Gate C still `null` ⇒ fail-closed preserved; no real execution); tests passing (not yet committed).

### Delivered

- Added the approval lifecycle module `src/heartbeat/executor.ts`: an injectable `HeartbeatApprovalGateway` port (`resolve(approvalId) → 'pending'|'approved'|'denied'|'expired'`) with a zero-I/O production stub `createReadOnlyApprovalGateway()` that always returns `'pending'` (the session-machinery bridge is deferred to Slice 4), plus the pure cross-tick lifecycle: `mintHeartbeatApprovalId()` (synthetic `hb-appr-<uuid>`), a 24 h `isHeartbeatApprovalExpired` check, `evaluateHeartbeatExecution`, and the single state-transition writer `applyHeartbeatApprovalPatch`. Resolve precedence short-circuits: no pending id ⇒ mint (gateway not consulted); pending-but-expired ⇒ reset (gateway not consulted); otherwise resolve the persisted id.
- Wired Gate B into the tick (`src/heartbeat/runner.ts`): replaced the Slice-1 hard-coded `approval: { status: 'none' }` with the resolved `{ status, approvalId }`, and added injectable `flags? / sandboxAvailable? / approvalGateway? / now?` seams (each defaulting to its production value). A `needs_user_action` task keeps the tick `dry_run_completed`; execution requires a subsequent externally-invoked tick (single-shot; honours `autoExecuteApprovedActions:false`).
- Added the read-only `nova heartbeat approvals` CLI (`src/cli/index.ts` + `src/cli/help.ts`): lists each task's `pendingApprovalId` / `pendingApprovalAt` / `lastApprovalId` / `lastExecStatus` from `state.json`, never decides and never mutates state.
- Extended `src/heartbeat/smoke.ts` with five OFFLINE scenarios on a fixed clock + tracking gateway: cross-tick approve → execute → fresh re-mint (SI-10 / SI-9), denied ⇒ blocked, 25 h expiry ⇒ needs_user_action with the gateway never consulted, master-flag-off V2 parity with a gateway injected (SI-1), and the read-only CLI leaving state byte-identical. The directory-wide static guard now sweeps 13 heartbeat modules and asserts no `.decide(` in `executor.ts` (SI-3).
- Invariants preserved: production Gate C (`probeExecutionSandbox()`) still returns `null` ⇒ fail-closed; package version stays `0.1.0`; no new dependency; heartbeat writes stay under `.nova/heartbeat/` only; no daemon / scheduler / LLM / tool / network / real execution.

### Verification run

- `npm run typecheck` and the offline `npm run check` gate exit 0; `npm run heartbeat:smoke` passes (Slice 1 truth-table + migration + guard, plus the five Slice 2 approval-lifecycle scenarios), fully offline.
- See the latest implementation report for exact command output and exit codes.

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
