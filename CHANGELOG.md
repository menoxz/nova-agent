# Changelog

All notable Nova Agent changes are documented here. Nova uses the version declared in `package.json` as the single package version source.

## 0.1.0 — Initial local product baseline

### Added

- Runtime durable V1: local session/run metadata, replay/resume foundations, current-session pointer, approvals, conversation persistence, context/token budget metadata, and safe config defaults.
- Streaming UX V1/V1.1: live CLI rendering with compact/normal/verbose modes, metrics, tool events, safe reasoning display, and fallback compatibility with non-streaming execution.
- Streaming Event Log / Replay V1: redacted JSONL event logs under `.nova/streaming/events` plus read-only `nova streaming logs/show/replay` commands.
- LLM Robustness V1: timeout, retry/backoff controls, provider error classification, and clear diagnostics without automatic provider/model switching.
- CLI Help / Command UX V1: global and domain help available without `LLM_API_KEY`, documented flags, and educational unknown/missing command errors.
- Batch Mode V1/V1.1: sequential `.txt`/`.json` prompt files, structured JSON reports, streaming/event-log/report controls, `--continue-on-error`, `--dry-run`, `--limit`, `--only`, and `--from`.
- TUI Prototype V0.1: read-only `nova tui replay <logId>` and `nova tui latest` with compact/normal/verbose replay snapshots from existing event logs.
- Packaging / Install UX V1: `bin/nova.js` wrapper, `bin.nova`, build/local-link smoke coverage, and development fallback through `tsx` when `dist/` is absent.
- Release Notes / Versioning V1: `nova --version`, `nova -v`, `nova version`, help/version docs, and this initial changelog.

### Safety and packaging notes

- Read-only inspection/help/replay/version paths do not require `LLM_API_KEY` and do not invoke LLM/tools.
- `.env`, `.nova/`, `dist/`, `node_modules/`, IDE files, traces, raw prompts, and runtime reports remain outside versioned source.
- No npm publish, git tag, remote push, provider switch, or packaging system refactor is part of this baseline.
