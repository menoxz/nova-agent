# Changelog

All notable Nova Agent changes are documented here. Nova uses the version declared in `package.json` as the single package version source.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
