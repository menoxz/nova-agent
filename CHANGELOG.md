# Changelog

All notable Nova Agent changes are documented here. Nova uses the version declared in `package.json` as the single package version source.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Heartbeat V3 (Slice 3) — real hardened execution sandbox, capability-only & opt-in (ADR-002 §14)** — adds the real subprocess sandbox `src/sandbox/sandbox.ts` (`createExecutionSandbox()`) behind Gate C: a **shell-free** single-command spawn (`shell:false`), an **allow-list-only** child environment (never `...process.env`), a `cwd` jailed under `PROJECT_ROOT`, a deterministic wall-clock timeout and combined stdout/stderr truncation budget (both force `exitCode: null`), and full process-tree teardown. The Slice-1 always-`null` probe becomes **strict opt-in**: `probeExecutionSandbox()` returns a live sandbox only when `NOVA_ENABLE_EXEC_SANDBOX` is exactly `"1"`/`"true"` (**SB1**) on a supported platform, otherwise `null` (fail-closed preserved). Caller-supplied env can never override base loader vars (`PATH`, plus Windows `SystemRoot`/`COMSPEC`/`PATHEXT`) and loader-injection vars (`LD_PRELOAD`/`LD_LIBRARY_PATH`/`NODE_OPTIONS`/`DYLD_*`) are dropped on a null-prototype env (**SB2**). The sandbox is a **capability only** — `run()` has zero callers in `src/heartbeat/**` (the runner reads only `.available`), the executor execute branch is unchanged, and all spawn/timer primitives stay under `src/sandbox/**` so the heartbeat static guard is untouched. Adds `npm run sandbox:smoke` (9 tests) into the `check`/`check:fast` gate; package stays `0.1.0`, zero new dependencies (node builtins only).
- **Heartbeat V3 (Slice 2) — cross-tick approval lifecycle (ADR-002 §13)** — wires Gate B across single-shot ticks via a new `src/heartbeat/executor.ts`: an injectable `HeartbeatApprovalGateway` port with a zero-I/O production stub (always `'pending'`; the session bridge is deferred to Slice 4), synthetic `hb-appr-<uuid>` approval ids, a 24 h expiry, and a pure mint → resolve → patch lifecycle. A due `ok` task mints an approval and halts at `needs_user_action` (Nova never calls `decide`); a subsequent tick resolves the persisted id — `approved` unlocks Gate B (real execution still refused while the production sandbox is absent), `denied` ⇒ `blocked`, `expired` (> 24 h) ⇒ re-request without consulting the gateway. Adds a read-only `nova heartbeat approvals` CLI that lists the ledger without deciding or mutating state. Default-off behaviour stays byte-identical to V2; package stays `0.1.0`, zero new dependencies.
- **Heartbeat V3 (Slice 1) — fail-closed triple-gate execution scaffolding (ADR-002)** — a pure, side-effect-free `decideHeartbeatExecution` triple-gate (Gate A: composed `NOVA_ENABLE_HEARTBEAT_EXEC` master + per-capability `NOVA_ENABLE_LIVE_LLM`/`NOVA_ENABLE_WRITE_TOOLS` flags; Gate B: explicit approval; Gate C: execution-sandbox availability) wired into the dry-run tick behind a null sandbox probe (`src/sandbox/probe.ts` returns `null` for the whole of ADR-002). Default-off behaviour is byte-identical to V2 (dry-run, task stays `due`); with the master flag on and no sandbox the tick fails closed (`refused`, nothing executed, `lastRunAt` never advanced). The heartbeat state schema bumps 1 → 2 (additive, forward-readable). No daemon, scheduler, LLM/tool, network, or real execution — `execute`/`needs_user_action` remain inert scaffolding for later slices.
- CI/CD GitHub Actions pipeline added — `.github/workflows/ci.yml` (typecheck, build, and the offline smoke + mock eval `check` gate on push to `main` and on pull requests) and `.github/workflows/release.yml` (npm publish on `v*` tags, inert until the `NPM_TOKEN` repository secret is configured).
- **Live-LLM execution gate & ReAct injection seam (Phase 1)** — explicit `NOVA_ENABLE_LIVE_LLM` opt-in keeps live model calls disabled by default, plus an injectable `model?` seam that lets the ReAct loop run fully offline under a mock model (`dd5ed49`).
- **Heartbeat V2 — Planning & Automation** — two purely consultative commands on top of the V1 dry-run ticks: `nova heartbeat plan` (offline, deterministic schedule projection; default `6h` horizon / `50` max occurrences) and `nova heartbeat automation export` (operator-installable cron / systemd timer / Windows Task Scheduler manifests). No daemon, scheduler install, LLM/tool, or network call; writes remain under `.nova/heartbeat/` only.
- **Heartbeat interval consistency gate** — single `assertRepresentableInterval` check applied identically across the cron, systemd, and Windows renderers: accepts 1–59 minutes, whole hours 60–1380, and exactly 1440; rejects non-representable intervals (e.g. 90 / 1439 / 1500) with exit code 1.

### Fixed

- **Heartbeat cron `*/N` collapse (BUG-1)** — cron minute expressions no longer collapse; hourly cadences now render as hour-band cron (e.g. `60m` ⇒ `0 */1 * * *`).
- **Heartbeat Windows `/MO` for long intervals (BUG-2)** — Windows Task Scheduler `/MO` modifier is now emitted correctly for intervals ≥ 1440 minutes.
- **Single-source agent/tool protocol (Phase 1)** — removed the duplicated protocol definition so the agent and tools share one source of truth (`dd5ed49`).
- **Grep mid-file line numbers (Phase 1)** — the grep tool now reports correct line numbers for matches past the first line (`f2977ed`).

### Security

- **Heartbeat symlink jail-escape hardening (RISK-1)** — `src/utils/safe_io.ts` now resolves and rejects symlink-based escapes from the `.nova/heartbeat/` sandbox.

### Tests

- **Slice 2 approval-lifecycle smoke** — five OFFLINE scenarios added to `src/heartbeat/smoke.ts` (fixed clock + tracking gateway stub): cross-tick approve → execute → fresh re-mint (SI-10 / SI-9), denied ⇒ blocked, 25 h expiry ⇒ needs_user_action with the gateway never consulted, master-flag-off V2 parity with a gateway injected (SI-1), and the read-only `approvals` CLI leaving `state.json` byte-identical; the directory-wide static guard now sweeps 13 heartbeat modules and asserts no `.decide(` in `executor.ts` (SI-3).
- **13-case Heartbeat smoke matrix** — added to `src/heartbeat/smoke.ts` and wired into `npm run check` / `npm run check:fast`, covering the BUG-1/BUG-2 fixes and the interval-representability accept/reject boundaries.
- **Offline ReAct `agent:smoke` (Phase 1)** — deterministic ReAct loop smoke driven by the injectable mock model (`dd5ed49`).
- **Per-tool `tools:smoke` (Phase 1)** — exercises `execute()` across the 8 read-only built-in tools (`f2977ed`).

### Docs

- **ADR-002 §13 addendum (Heartbeat V3 Slice 2)** — records the implemented cross-tick approval lifecycle (`executor.ts` port + pure mint → resolve → patch), the read-only `nova heartbeat approvals` CLI, and the realized Open-Q3 (24 h expiry ⇒ `needs_user_action`) / Open-Q4 (approvals listing); `docs/heartbeat.md` gains a French Slice 2 note and an `approvals` CLI entry, and `PROJECT_STATUS.md` a Slice 2 milestone.
- **ADR-002 placed (Heartbeat V3)** — `docs/adr/ADR-002-heartbeat-v3.md` (Accepted) records the fail-closed triple-gate execution design and the per-slice breakdown; `docs/heartbeat.md` gains a V3 Slice 1 scaffolding note and `PROJECT_STATUS.md` a corresponding milestone row.
- **ADR-001 reconciled** — status moved `Proposed` → `Accepted / Implemented`, with the shipped defaults recorded (proposed 24 h / 10 → shipped 6 h / 50).
- **Heartbeat docs promoted V1 → V2** — `docs/heartbeat.md` now documents the `plan` and `automation export` surface; stale "V1 planning-only" strings flipped across the heartbeat docs and ADR.

### Notes

- Plan projection is deterministic via an injected clock and a sha256 `planId` over the inputs (RISK-2). Heartbeat invariants preserved: schema version 1, config zod `.strict()`, writes under `.nova/heartbeat/` only, package version unchanged at `0.1.0`, and no new dependencies.

## 0.1.0 — Initial local product baseline

First tagged-worthy release of Nova Agent: a local, safety-first autonomous agent baseline. All capabilities run locally with read-only-friendly defaults — no npm publish, remote push, git tag, provider switching, or background daemon is part of this release.

### Added

- **Runtime, LLM & streaming**
  - Durable local runtime: session/run metadata, replay/resume foundations, current-session pointer, approvals, conversation persistence, and context/token-budget tracking with safe config defaults.
  - LLM robustness: configurable timeouts, retry/backoff, provider error classification, and clear diagnostics without hidden provider/model switching.
  - Streaming UX with live CLI rendering (compact/normal/verbose), metrics, tool events, and safe reasoning display, plus a fallback to non-streaming execution.
  - TUI-ready streaming event layer and redacted JSONL event logs under `.nova/streaming/events`, exposed through read-only `nova streaming logs/show/replay`.
- **CLI & TUI**
  - CLI help and command UX available without `LLM_API_KEY`, with documented flags and educational unknown/missing-command errors.
  - Read-only TUI prototype: `nova tui replay <logId>` and `nova tui latest` with compact/normal/verbose replay snapshots from existing event logs.
- **Providers**
  - Safe provider/model profiles with read-only `nova providers list/show/doctor`, API-key presence diagnostics (no secret output), and explicit opt-in fallback metadata.
  - Expanded built-in provider/model catalogue and a metadata-only provider directory with supported/planned/gateway/custom classification.
  - Provider live-smoke readiness checks (offline/static by design).
- **Batch**
  - Batch mode for sequential `.txt`/`.json` prompt files with structured JSON reports, Markdown reports (`--report-md`), CI output (`--ci`), and execution controls including `--continue-on-error`, `--dry-run`, `--limit`, `--only`, and `--from`.
- **Eval & SLO**
  - Eval trace support and read-only eval reporting: `nova eval list/report/summary/compare` over local report artifacts, with Markdown summaries and stable compare deltas.
  - Local SLO dashboard for eval results.
- **Heartbeat**
  - Disabled-by-default `nova heartbeat` with `validate/status/tasks/tick --dry-run` and report-latest, planning-only task classification, an anti-overlap lock, and blocked dangerous autonomous actions.
- **Memory, subagents, profiles & policy**
  - Local knowledge/memory store, bounded sub-agent orchestration, agent profiles, and a permissions/policy core.
- **LSP & MCP**
  - Nova language server (LSP) and a Model Context Protocol (MCP) server.
- **Packaging & release**
  - Install UX: `bin/nova.js` wrapper, the `nova` bin entry, build/local-link smoke coverage, and a `tsx` dev fallback when `dist/` is absent.
  - Version commands (`nova --version`, `nova -v`, `nova version`) with version/help docs.
  - Local quality gate via `npm run check:fast` and `npm run check` (typecheck, key smokes, binary/version coverage, and mock eval suites).
  - Hardened release CLI UX.

### Fixed

- Hardened heartbeat safe reports so dry-run report generation stays secret-free and robust (`5bf8e5c`).
- Load `.env` before `nova config show` so configured values display correctly (`a142eaf`).

### Security

- Read-only security audit matrix for inspecting safe vs. sensitive paths (`ff7752c`).
- Release readiness and SLO gating to block releases that miss thresholds (`a7de714`, `1100f6b`).
- Slimmed release manifest to reduce the published package surface (`d0856d8`).

### Tests

- Targeted smoke-test coverage for key runtime paths (`f755860`).

### Docs

- Release-candidate dry-run checklist (`5c2fa17`).

### Safety and packaging notes

- Read-only inspection/help/replay/version paths do not require `LLM_API_KEY` and do not invoke LLM/tools.
- `.env`, `.nova/`, `dist/`, `node_modules/`, IDE files, traces, raw prompts, and runtime reports remain outside versioned source and the published package.
- No npm publish, git tag, remote push, provider switch, background daemon, or packaging-system refactor is part of this baseline.
