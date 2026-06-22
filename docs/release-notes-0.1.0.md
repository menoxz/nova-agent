# Nova Agent v0.1.0 — Release Notes

Nova Agent v0.1.0 is the first tagged-worthy release: a local, safety-first autonomous agent baseline. Everything runs locally with read-only-friendly defaults, and no publish/tag/push/daemon behavior is included.

## Highlights

- **Durable local runtime** with session/run metadata, replay/resume foundations, approvals, and conversation persistence.
- **Streaming UX + read-only replay** across the CLI and a TUI prototype (`nova tui replay`, `nova tui latest`) backed by redacted event logs.
- **Provider profiles, catalogue, and directory** with read-only inspection (`nova providers list/show/doctor`) and no secret output or hidden provider switching.
- **Batch mode** for sequential prompt files with JSON/Markdown reports and CI-friendly output.
- **Local eval reporting and SLO dashboard** (`nova eval list/report/summary/compare`) over local artifacts, in mock/replay modes.
- **Safe, disabled-by-default heartbeat** that only plans (dry-run) and refuses dangerous autonomous actions.

## Added (summary)

- Runtime, LLM robustness, and streaming (live rendering, redacted event logs, replay).
- CLI help/UX without an API key, and a read-only TUI replay prototype.
- Provider profiles, an expanded model catalogue, a metadata directory, and live-smoke readiness (offline/static).
- Batch mode with JSON/Markdown/CI reports and execution controls (`--continue-on-error`, `--dry-run`, `--limit`, `--only`, `--from`).
- Eval trace + read-only reporting and an SLO dashboard.
- Heartbeat dry-run planning, a local memory/knowledge store, bounded sub-agents, agent profiles, and a policy/permissions core.
- A Nova language server (LSP) and an MCP server.
- Packaging/install UX, version commands, and a local quality gate.

## Fixed

- Heartbeat safe reports hardened to stay secret-free and robust (`5bf8e5c`).
- `.env` now loads before `nova config show`, so configured values display correctly (`a142eaf`).

## Security & packaging hardening

- Read-only security audit matrix for safe vs. sensitive paths (`ff7752c`).
- Release readiness and SLO gating that block releases failing thresholds (`a7de714`, `1100f6b`).
- Slimmed release manifest to minimize the published package surface (`d0856d8`).
- Read-only/help/version paths require no `LLM_API_KEY` and invoke no LLM/tools; secrets, traces, and raw prompts stay out of source and the published package.

## Known limitations

- **Provider live smoke is offline/static by design** — readiness checks do not make live network calls in this baseline.
- **Heartbeat is dry-run/planning only** — there is no background daemon, and dangerous autonomous actions are blocked.
- **TUI is a read-only replay prototype** — it renders snapshots from existing event logs rather than a live interactive interface.
- **Eval runs in mock/replay modes** — local eval suites do not call live providers and have no secret or raw-trace access.

## Install & usage

- Install and packaging: [`docs/packaging-install.md`](./packaging-install.md)
- CLI usage and commands: [`docs/cli-usage.md`](./cli-usage.md)
- Operations runbook: [`docs/RUNBOOK.md`](./RUNBOOK.md)
- Provider live-smoke readiness: [`docs/provider-live-smoke-readiness.md`](./provider-live-smoke-readiness.md)
- Release-candidate dry-run checklist: [`docs/release-candidate-dry-run-checklist.md`](./release-candidate-dry-run-checklist.md)
- Full change list: [`CHANGELOG.md`](../CHANGELOG.md)
