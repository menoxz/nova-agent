# Provider Live Smoke Readiness Plan V1

This plan prepares Nova for a provider live smoke while keeping default work local, offline, metadata-only, and mock-only. A real live smoke remains gated by explicit operator authorization plus environment preconditions.

## Safety boundaries

- No live provider, LLM, network, tool-live, daemon, autonomous, publish, tag, push, or PR action is in scope.
- Do not read or edit `.env`, secrets, credentials, prompts, raw `.nova/traces`, raw `.nova/evals`, or raw `.nova/reports`.
- Use only static provider metadata, synthetic adapter/error fixtures, sanitized docs, and mock evals.
- `providers doctor` may report `LLM_API_KEY` presence or absence only; it must never print a key value.
- Live smoke remains blocked unless an operator gives explicit per-run authorization **and** `NOVA_ENABLE_LIVE_LLM=1|true` plus `LLM_API_KEY` are present in the process environment.

## Inventory to verify offline

| Area | Offline evidence | Boundary |
| --- | --- | --- |
| Provider profiles | `nova providers list`, `nova providers show <id>`, `npm run providers:smoke` | Static built-in profile metadata only. |
| Provider directory | Directory categories and runtime-executable flags | Metadata-only catalog; planned/gateway entries are not claimed executable. |
| Providers doctor | `nova providers doctor` and existing provider smoke | Key presence status only; no provider request. |
| Fallback | Explicit fallback profile ids and warnings | Opt-in only; no silent automatic provider switching. |
| Protocol mapping | Profile protocol is `openai-chat-completions` or `anthropic-messages` | No protocol probing over network. |
| Robustness/error handling | `npm run llm:smoke` | Synthetic timeout/retry/error classification only. |
| Security/read-only matrix | `npm run security:readonly-audit`, `npm run security:readonly-smoke` | Read-only compatibility for offline smokes; live provider smoke remains blocked. |

## Readiness phases

1. **Metadata-only readiness** — count profiles, directory categories, runtime support, protocols, provider doctor boundaries, fallback explicitness, and read-only matrix coverage.
2. **Synthetic adapter/error readiness** — exercise only local fixtures for provider profile resolution, fallback warnings, URL redaction, timeout/retry classification, and endpoint/auth/rate-limit labels.
3. **Redaction and secret-handling readiness** — verify no command prints secret values, no report reads `.env`, and no raw `.nova` artifacts are inspected.
4. **Future live-smoke authorization gate** — only after phases 1-3 pass, require explicit written operator authorization with provider id, model, account, budget, prompt text, tool policy, rollback/abort rules, and evidence retention path.

## Operator checklist

- [ ] Confirm this run is offline/mock-only and does not need `.env` or credentials.
- [ ] Run the safe commands listed below from the repository root.
- [ ] Confirm no command asks for an API key, performs network/provider calls, runs tools live, or starts a daemon.
- [ ] Confirm generated reports are sanitized summaries only, not raw prompts/traces/evals/reports.
- [ ] Confirm security matrix still marks live provider smoke as read-only incompatible.
- [ ] Stop immediately on any unexpected network/provider/secret/raw artifact behavior.

## Exact safe commands and expected evidence

```bash
npm run typecheck
```

Expected evidence: TypeScript no-emit check exits `0`; no provider call and no generated `dist/` output.

```bash
npm run providers:smoke
```

Expected evidence: `providers:smoke passed`; provider list/show/doctor remain offline and secret-redacted.

```bash
npm run llm:smoke
```

Expected evidence: synthetic robustness smoke passes; timeout/retry/error classifications are local fixtures only.

```bash
npm run providers:readiness-smoke
```

Expected evidence: static readiness report checks pass; no `.env`, provider, network, raw `.nova`, or daemon behavior.

```bash
npm run security:readonly-audit
npm run security:readonly-smoke
```

Expected evidence: offline readiness smoke/eval are classified as local validation and live provider smoke remains blocked/read-only-incompatible.

```bash
npm run eval:provider-readiness
```

Expected evidence: mock eval suite passes and writes only local eval report metadata through the existing mock runner; it does not call providers.

```bash
npm run check:fast
git diff --check
```

Expected evidence: fast local gate exits `0`; diff whitespace check exits `0`.

## Authorization criteria before any future live provider/LLM call

A future live smoke is still out of scope unless all criteria below are met in a separate, explicitly authorized task:

1. Offline gates above pass in the same working tree.
2. The operator names the provider profile, model, base URL class, budget ceiling, single prompt, and expected response shape.
3. The operator confirms which credential source is allowed without revealing the credential value.
4. Tool execution is disabled unless separately approved with an allowlist.
5. The run has an abort threshold for auth errors, rate limits, endpoint mismatch, network errors, unexpected tool calls, or secret exposure.
6. The evidence path is sanitized and excludes raw prompts, raw traces, raw eval reports, and secret-bearing logs.

## Current gated live-smoke command

```bash
npm run llm:live-smoke
```

Safety contract:

- refuses with exit `0` unless both `NOVA_ENABLE_LIVE_LLM=1|true` and `LLM_API_KEY` are present;
- performs exactly one `generateText()` request when gates are present;
- tools are omitted/disabled, no `stopWhen`, max `64` output tokens, `temperature=0`, `maxRetries=0`;
- expected sentinel is `NOVA_LIVE_OK`;
- output is sanitized: adapter, provider/model constants, HTTP status class, sentinel boolean, usage counts, finish reason;
- failures are classified by kind/status class and never print raw provider bodies or credential values.

Most recent gate check: the command skipped cleanly because the process environment had no live opt-in flag and no API key. To run a real smoke, set the two environment variables in your shell without logging or documenting the key value, then rerun the command.

## Failure modes and abort criteria

- Abort if a command reads `.env`, prints a secret, opens raw `.nova/traces`, raw `.nova/evals`, or raw `.nova/reports`, or requests credentials.
- Abort if a smoke/eval attempts a network/provider/LLM call or starts daemon/autonomy.
- Abort if provider fallback becomes silent/automatic instead of explicit.
- Abort if planned/gateway directory entries are shown as runtime executable without an implemented adapter and offline proof.
- Abort if the read-only matrix marks any live provider smoke or prompt path as orchestrator read-only compatible.
- Roll back only the readiness-plan changes if validation fails outside the planned scope; do not commit, publish, tag, push, or create a PR.

## Explicit out of scope

- No ungated live provider/LLM/network call.
- No `.env`, secrets, credentials, prompts, raw `.nova/traces`, raw `.nova/evals`, or raw `.nova/reports` reads/edits.
- No tools live, daemon, autonomy, publish, tag, push, or PR.
- No major provider/LLM architecture refactor.
