# Trace & Eval

Nova includes a local-first trace/eval module to improve the ReAct loop from real usage without exposing secrets or enabling uncontrolled self-modification.

## Tracing

Tracing records each agent run as structured JSON. V2 trace reports use `schemaVersion: 2` and are read through a small normalizer that still accepts V1 trace files for summaries/replay.

- run metadata: model, max steps, enabled tool names
- tool catalog metadata with a `kind` field (`builtin` today; reserved for future `mcp`, `lsp`, or external tool providers)
- LLM steps: text preview, tool call/result counts
- tool calls and tool results
- tool execution timings and errors
- final answer preview
- aggregate metrics: duration, step count, tool call count, error count

Traces are disabled by default. Enable them with:

```bash
NOVA_TRACE=1 npm start -- "Inspect this repository"
```

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NOVA_TRACE` | disabled | Set `1` or `true` to write traces. |
| `NOVA_TRACE_DIR` | `.nova/traces` | Output directory for trace files. |
| `NOVA_TRACE_ALLOW_OUTSIDE` | disabled | Set `1` to allow `NOVA_TRACE_DIR` outside `.nova/`. |
| `NOVA_TRACE_INCLUDE_CONTENT` | `true` | Set `false` to omit prompt/tool/answer content previews. |
| `NOVA_TRACE_CONTENT_MAX_CHARS` | `2000` | Maximum string preview length. |

Trace files are written under `.nova/`, which is ignored by git. Custom trace directories outside `.nova/` fail by default unless `NOVA_TRACE_ALLOW_OUTSIDE=1` is set. Likely secrets are redacted by key name and common token patterns before writing, but traces can still contain sensitive prompts, tool outputs, file paths, and model responses. Treat trace and eval report artifacts as sensitive local data and do not commit or share them without review.

### Summarize traces

```bash
npm run trace:summary
npm run trace:summary:json
npm run trace:summary -- --trace-dir .nova/traces --limit 100
```

The summary reports success/error counts, average duration, average steps, average tool calls, most-used tools, and recent runs. It also emits simple diagnostic insights for repeated consecutive tool calls, tool execution errors, failed runs, unusually high tool-call counts, and suspiciously short final answers.

## Evaluation harness

The eval runner judges measurable scenarios in three modes:

- `mock` (default): deterministic and offline; no `LLM_API_KEY` required.
- `live`: runs scenarios through `NovaAgent` and writes per-scenario traces.
- `replay`: evaluates an existing eval report, trace JSON, or trace directory without an LLM.

V2 eval reports use `schemaVersion: 2`; V1 reports remain readable for replay and baseline comparison.

```bash
npm run eval
npm run eval:mock
npm run eval:smoke
npm run eval:core
```

List scenarios and suites:

```bash
npm run eval -- --list
npm run eval:list
npm run eval -- --list-suites
```

Run one scenario:

```bash
npm run eval:smoke
npx tsx src/eval/runner.ts --scenario targeted-file-read
npx tsx src/eval/runner.ts --mode mock targeted-file-read
```

Run live scenarios (requires `LLM_API_KEY`):

```bash
npx tsx src/eval/runner.ts --mode live --suite smoke
```

Replay a previous report or trace directory without an LLM:

```bash
npm run eval:replay -- --replay .nova/evals/<evalRunId>/report.json
npx tsx src/eval/runner.ts --mode replay --replay .nova/evals/<evalRunId>/traces
```

Use a custom JSON scenario catalog:

```bash
npm run eval -- --scenarios ./my-scenarios.json
```

Write a custom report path:

```bash
npm run eval -- --out .nova/evals/report.json
```

Eval report output paths must stay under `.nova/` by default. Use `--allow-outside-output-dir` only when you intentionally need to write a report elsewhere.

Report formats:

```bash
npm run eval -- --report json
npm run eval -- --report markdown
npm run eval -- --report both
```

`report.json` is always written. Markdown output is written next to it when `--report markdown` or `--report both` is selected; `both` is the default for local eval runs.

### Suites

Built-in suites are intentionally small and explicit:

| Suite | Scenarios | Purpose |
| --- | --- | --- |
| `smoke` | `targeted-file-read` | Stable fast sanity check for CI/local use. |
| `core` | all default scenarios | Broader functional coverage. |
| `safety` | `safe-git-status` | Read-only/destructive-action guardrail. |

Select suites and scenarios together when needed:

```bash
npx tsx src/eval/runner.ts --suite safety repo-orientation
```

### Quality gates and baselines

Every report contains quality-gate results. Defaults require a 100% pass rate and zero runner errors, which makes mock evals strict and deterministic. Optional gates:

```bash
npx tsx src/eval/runner.ts --suite core --min-pass-rate 0.95 --max-errors 0 --max-average-tool-calls 10 --max-scenario-tool-calls 25
```

Compare a current run to a previous JSON report:

```bash
npx tsx src/eval/runner.ts --suite core --baseline .nova/evals/baseline/report.json
```

Baseline comparison flags scenario-level regressions when a previously passing scenario now fails/errors, when pass rate decreases, or when error count increases. The process exits non-zero if gates fail or a baseline regression is detected.

Each eval run writes:

- `report.json`: scenario results, checks, pass rate, average tool calls/steps, gates, and optional baseline comparison
- `report.md`: Markdown summary when markdown reporting is enabled
- per-scenario traces under `.nova/evals/<evalRunId>/traces` for live mode

Scenario checks support required tools (`expectedTools`), valid alternative tools (`expectedAnyTools`), forbidden tools, final-answer substrings, and step/tool-call budgets.

Current default scenarios cover:

1. repository orientation with read-only behavior
2. targeted source file read
3. safe git status via the read-only git tool

## Reading results to improve ReAct

Use traces and eval reports to identify patterns such as:

- repeated or unnecessary tool calls
- missing read-before-write behavior
- use of broad tools where targeted tools fit better
- errors not recovered by the agent
- final answers without enough evidence
- excessive step counts for simple tasks

Recommended improvement cycle:

```text
real usage → trace summary → inspect failed traces → update tool descriptions/policies → run eval → compare report
```

This module does **not** automatically rewrite prompts, tools, or code. It provides evidence and metrics for controlled improvements.
