# ADR-001 — Heartbeat Planning & Automation (planning-only, dry-run, disabled-by-default)

- **Status:** Proposed
- **Date:** 2026-06-22
- **Deciders:** Architecture
- **Scope:** `src/heartbeat/**`, `src/config/project.ts`, `src/cli/help.ts` (design only — no code in this ADR)
- **Supersedes:** none (first ADR recorded under `docs/adr/`; `docs/adr/` is created by this change)
- **Companion:** [`ADR-001-heartbeat-planning-automation-breakdown.md`](./ADR-001-heartbeat-planning-automation-breakdown.md) (per-file module breakdown, test plan, implementer task template)

> This iteration is internally referred to as **Heartbeat V2 "planification & automatisation"**. It is an *additive extension* of the existing Heartbeat V1 (dry-run planning ticks). V1 guarantees are preserved verbatim; nothing in V2 executes tasks, starts a daemon, calls an LLM, calls a tool, or touches the network.

---

## 1. Context

Heartbeat V1 (`docs/heartbeat.md`) already gives the agent a **safe, dry-run-only** way to *classify* configured maintenance tasks (`due` / `skipped` / `blocked` / `needs_user_action`) at the moment a human runs `nova heartbeat tick --dry-run`. It never loops, never schedules itself, and persists only redacted metadata under `.nova/heartbeat/`.

Two capabilities are missing for operators who want to *plan ahead* and *eventually* wire periodic maintenance into their own OS scheduler:

1. **Forward visibility.** V1 answers "is this task due *right now*?" It cannot answer "what is the projected cadence of my tasks over the next 24 h, and which occurrences would be blocked or fall in a quiet window?" Operators must be able to *preview* a schedule offline, deterministically, before enabling anything.

2. **Operator-installable automation.** Nova deliberately refuses to schedule itself. But operators legitimately want a *ready-to-edit* manifest (cron line / systemd timer / Windows Task Scheduler command) that *they* install to invoke `nova heartbeat tick --dry-run` periodically. Today they must hand-write it.

### Forces & constraints (all HARD / immutable)

| # | Constraint | Source |
|---|---|---|
| C1 | **Extend, do not rewrite.** V1 exports and behaviour stay backward compatible. | Mission |
| C2 | **Disabled by default.** `heartbeat.enabled === true` opt-in remains. | V1 / Mission |
| C3 | **No daemon / `setInterval` / `setTimeout` / `setImmediate` / cron runner / background process / self-loop.** Any "automation" is a *plan* or an *external manifest the human installs themselves*. | Mission |
| C4 | **No live execution, no LLM call, no tool call, no network, no writes outside `.nova/heartbeat/`** by heartbeat itself. | V1 / Mission |
| C5 | **Redaction on every persisted/printed artifact** via `safeHeartbeat*`. No secrets, no absolute paths. | V1 / Mission |
| C6 | **Config stays zod `.strict()`.** New fields optional + backward compatible. | `src/config/project.ts` |
| C7 | **Bump `HEARTBEAT_SCHEMA_VERSION` only if the persisted state shape changes**, with migration notes. | Mission |
| C8 | Validation = repo npm scripts (`typecheck` / `build` / `cli:smoke` / `heartbeat:smoke`), not pytest. | Mission |
| C9 | **Determinism / offline-testability** via injected time source (fixed clock). | Mission |

### Existing surface this builds on (must remain compatible)

- `types.ts` — `HEARTBEAT_SCHEMA_VERSION = 1`; `HeartbeatScheduleConfig {type:'manual'|'interval', everyMinutes?}`; `HeartbeatTaskConfig`; `HeartbeatConfig {enabled?, tasks?}`; `HeartbeatState`; `HeartbeatTaskResultStatus = 'due'|'skipped'|'blocked'|'needs_user_action'`; `HeartbeatTickReport`.
- `config.ts` — `resolveHeartbeatConfig`, `normalizeHeartbeatSchedule`, `classifyHeartbeatTaskSafety`, `isHeartbeatDangerousKind`; `SAFE_KINDS`/`SAFE_ACTIONS`/`DANGEROUS`.
- `runner.ts` — `runHeartbeatDryRunTick`, `planHeartbeatTask` (pure interval math over injected `now`).
- `paths.ts` / `store.ts` — `.nova/heartbeat/{state.json,ticks/,locks/heartbeat.lock}`; `assertPathUnderDir` sandbox guard.
- `reporter.ts` / `redaction.ts` — markdown render + `safeHeartbeat{Text,Path,TaskResult,Report}`.
- `index.ts` — `handleHeartbeatCommand` (`validate|status|tasks|tick --dry-run|report latest`), dispatched after `handleHelpCommand` in `src/index.ts`; `heartbeat --help` is rendered by `heartbeatHelp()` in `src/cli/help.ts`.
- `src/config/project.ts` — `heartbeatTaskSchema` (`schedule:{type:'manual'|'interval', everyMinutes?}`, `.strict()`, secret-like rejection, duplicate-id rejection).

---

## 2. Decision

Add three planning-only capabilities to the heartbeat module, all expressed as **pure functions over an injected clock** plus **one sandboxed write** under `.nova/heartbeat/`. No new runtime dependencies.

### D1 — Richer (but deterministic) schedule model: **interval + anchor + quiet hours + timezone**

Extend the schedule vocabulary *without adding a new `type` value*:

- **`schedule.anchor?: string` (ISO-8601, interval only)** — a phase reference so occurrences land on predictable wall-clock points (e.g. anchor `…T00:00:00Z`, every `60` → `:00` each hour) instead of drifting from `lastRunAt`.
- **`heartbeat.timezone?: string` (IANA, default `"UTC"`)** — wall-clock reference for quiet hours, validated via the built-in `Intl.DateTimeFormat` (no dependency; Node 22 ships ICU).
- **`heartbeat.quietHours?: { start: "HH:MM"; end: "HH:MM" }[]`** — global blackout windows (wall-clock in `timezone`). An occurrence that would run inside a quiet window is **re-classified `quiet_hours`** in the projection — it is *informational only* and still never executes.

Projection anchor precedence (forward-looking): `schedule.anchor` → `state.tasks[id].lastRunAt` → `now`. All math is epoch-millisecond arithmetic; quiet-hour membership is the only timezone-aware step and it uses read-only `Intl` formatting.

**Raw cron strings are explicitly deferred** (see Alternative A2). interval+anchor+quietHours+timezone covers the operator need ("run on a clean cadence, but not at night") with deterministic, dependency-free, DST-isolated math, and keeps the manifest export decoupled from internal scheduling (D3).

### D2 — Plan projection command: `nova heartbeat plan`

```
nova heartbeat plan [--now <iso>] [--horizon <duration>] [--max <N>] [--json]
```

- Pure core `projectHeartbeatPlan({ config, state, now, horizonMinutes, maxPerTask, timezone })` → for each task, the projected next occurrences within `[now, now + horizon]` (both bounds inclusive), each classified `would_run` or `quiet_hours`. Task-level gates reuse `classifyHeartbeatTaskSafety` (`blocked` / `needs_user_action`) and config (`manual`, disabled). 
- **Read-only with respect to `state.json`** — unlike `tick`, `plan` never mutates heartbeat state (lower blast radius; idempotent).
- Persists a **redacted** artifact pair under `.nova/heartbeat/plans/<planId>.{json,md}`.
- **Deterministic `planId`** = `plan_<sha256(now|horizon|max|timezone|configDigest)>` (first 16 hex). Same inputs → same id → idempotent overwrite with identical bytes. No wall-clock/random in the id.
- `--horizon` accepts `90m` / `24h` / `7d` (suffix `m|h|d`, bare integer = minutes); default `24h`. `--max` default `10`, hard-capped.

### D3 — Automation manifest export: `nova heartbeat automation export`

```
nova heartbeat automation export --target <windows-task|systemd|cron>
                                 [--every <duration> | --at <HH:MM>]
                                 [--stdout] [--out <relpath-under-.nova>] [--json]
```

- Pure builder `buildAutomationManifest({ target, tickEveryMinutes?, tickAt?, timezone })` → a **non-installed, operator-only** text manifest whose scheduled command is **always** `nova heartbeat tick --dry-run`.
- **Placeholders, never real paths:** the body uses `<PROJECT_DIR>` and `<NOVA_BIN>` tokens the operator substitutes. This satisfies C5 (no absolute paths) *and* keeps the manifest machine-portable.
- **Sandbox-only writes (C4):** the canonical copy is written to `.nova/heartbeat/automation/<target>.txt` and echoed to stdout. `--stdout` prints only (no file). `--out` is accepted **only if it resolves under `.nova/heartbeat/`** (`assertPathUnderDir`); any path escaping the sandbox is rejected with a clear error. Nova **never** writes to system scheduler locations.
- **Tick cadence is decoupled from task schedules.** The manifest tells the OS to invoke `tick --dry-run` every `tickEveryMinutes` (or at `tickAt`); per-task `due`-ness is then decided *inside* the dry-run. Default cadence = `min(everyMinutes of safe enabled interval tasks)` clamped to `[5, 1440]`, or `15` if none. Because of this decoupling, **no internal cron parser is needed to emit a cron manifest.**
- Every manifest carries a prominent banner: *"Operator must install this manually. Nova does not schedule itself. The scheduled command is dry-run planning only — it executes nothing."*
- **Deterministic body:** no embedded generation timestamp → same flags produce identical bytes (testable).

### D4 — Time-source injection & determinism

All schedule math lives in a new pure module `src/heartbeat/schedule.ts` (`parseDurationMinutes`, `nextIntervalOccurrence`, `projectIntervalOccurrences`, `isInQuietHours`) operating on injected `now`/epoch inputs. The CLI exposes `--now <iso>` so the whole pipeline is reproducible offline with a fixed clock. The deterministic acceptance check (breakdown §Test Plan) pins `--now`, `--horizon`, `--max`, `timezone: UTC` and asserts an exact occurrences array.

### D5 — Backward compatibility & migration

- All config additions are **optional and `.strict()`-compatible** → existing `.nova/config.json` files validate unchanged (C6).
- **`HEARTBEAT_SCHEMA_VERSION` stays `1`.** The persisted `HeartbeatState` shape is **unchanged**: `plan` does not write state, and `plans/` + `automation/` are independent artifact directories read like `ticks/`. Therefore **no state migration** is required (C7).
- New artifacts (`HeartbeatPlanReport`, automation manifests) are stamped `schemaVersion: 1`; they are brand-new, so there is no prior-instance back-compat concern.

---

## 3. Data model (design)

> Types below are the *design contract* for the implementer (full per-file mapping in the breakdown). `?` = optional. Existing types are extended additively; no field is removed or retyped.

```ts
// types.ts — additive
interface HeartbeatScheduleConfig {        // EXTENDED
  type: 'manual' | 'interval';             // unchanged enum
  everyMinutes?: number;
  anchor?: string;                         // NEW — ISO-8601, interval only
}

interface HeartbeatQuietWindow {           // NEW
  start: string;                           // "HH:MM" 24h, inclusive
  end: string;                             // "HH:MM" 24h, exclusive; start>end wraps midnight
}

interface HeartbeatConfig {                // EXTENDED
  enabled?: boolean;
  tasks?: HeartbeatTaskConfig[];
  timezone?: string;                       // NEW — IANA, default "UTC"
  quietHours?: HeartbeatQuietWindow[];     // NEW — global blackout windows
}

type HeartbeatPlanTaskStatus =             // NEW (does NOT overload HeartbeatTaskResultStatus)
  | 'projected' | 'manual' | 'skipped' | 'blocked' | 'needs_user_action';

interface HeartbeatPlanOccurrence {        // NEW
  at: string;                              // ISO-8601 occurrence time
  classification: 'would_run' | 'quiet_hours';
  note?: string;                           // e.g. matched quiet window
}

interface HeartbeatPlanTask {              // NEW
  id: string; name?: string; kind: string; action?: string;
  enabled: boolean;
  schedule: HeartbeatScheduleConfig;
  status: HeartbeatPlanTaskStatus;
  reason: string;
  firstDueAt?: string;
  occurrences: HeartbeatPlanOccurrence[];  // empty for manual/disabled/blocked/needs_user_action
}

interface HeartbeatPlanReport {            // NEW — stamped schemaVersion 1
  schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;   // = 1
  heartbeatId: string;
  planId: string;                          // deterministic
  generatedForNow: string;                 // the injected `now`
  horizonMinutes: number;
  maxPerTask: number;
  timezone: string;
  heartbeatEnabled: boolean;
  preview: boolean;                        // true when heartbeatEnabled === false
  counts: { tasks: number; projected: number; quietHours: number;
            manual: number; skipped: number; blocked: number; needsUserAction: number;
            occurrences: number };
  tasks: HeartbeatPlanTask[];
  safety: {                                // same invariants as the tick report
    llmInvoked: false; toolsInvoked: false; autonomousActionsExecuted: false;
    schedulerInstalled: false; secretsIncluded: false;
    contentPolicy: 'metadata-only-redacted'; notes: string[];
  };
  paths: { json: string; markdown: string };
}

type HeartbeatAutomationTarget = 'windows-task' | 'systemd' | 'cron';   // NEW

interface HeartbeatAutomationManifest {    // NEW
  target: HeartbeatAutomationTarget;
  tickEveryMinutes?: number;
  tickAt?: string;                         // "HH:MM"
  timezone: string;
  invokes: 'nova heartbeat tick --dry-run';// literal invariant
  installed: false;                        // Nova never installs
  body: string;                            // placeholderized, redacted, deterministic
  paths: { file?: string };               // sandbox path, omitted when --stdout
}
```

### Persistence layout additions (sandbox only)

```
.nova/heartbeat/
├── state.json                     # UNCHANGED (schemaVersion 1, written by tick only)
├── ticks/<tickId>.json|.md        # UNCHANGED
├── locks/heartbeat.lock           # UNCHANGED (plan + export also serialize via withLock)
├── plans/<planId>.json|.md        # NEW — redacted plan projections, deterministic ids
└── automation/<target>.txt        # NEW — operator-only manifests (cron.txt|systemd.txt|windows-task.txt)
```

---

## 4. CLI surface (design)

| Command | Purpose | Writes | State mutation |
|---|---|---|---|
| `nova heartbeat plan [--now <iso>] [--horizon <dur>] [--max <N>] [--json]` | Project next occurrences per task within a horizon, classified `would_run`/`quiet_hours`; task gates reuse existing safety. | `.nova/heartbeat/plans/<planId>.{json,md}` | **none** |
| `nova heartbeat automation export --target <…> [--every <dur>\|--at <HH:MM>] [--stdout] [--out <relpath>] [--json]` | Emit operator-installable manifest invoking `tick --dry-run`. | `.nova/heartbeat/automation/<target>.txt` (or stdout-only) | **none** |

Both subcommands are dispatched inside the existing `handleHeartbeatCommand` switch, after the existing `validate|status|tasks|tick|report` branches; `heartbeat --help` (rendered by `heartbeatHelp()` in `src/cli/help.ts`) gains two rows + one clarifying line. Unknown flags / escaping `--out` / bad `--target` produce `heartbeatUsageError` (exit 1) with guidance — consistent with V1.

---

## 5. Explicit NON-GOALS (this iteration will NOT do any of these)

1. **No daemon, scheduler, timer, or self-loop.** No `setInterval` / `setTimeout` / `setImmediate` / `while(true)` / background worker. `plan` and `automation export` are single-shot and return.
2. **No OS scheduler registration.** Nova never runs `schtasks /Create`, `systemctl enable`, `crontab -`, or writes to `/etc`, `/Library`, the Windows Task Scheduler store, or any path outside `.nova/heartbeat/`. It only *emits text the operator installs*.
3. **No live execution / autonomy.** No task is ever run. `plan` projects; it does not act.
4. **No LLM calls.** No import of `src/llm`, `src/providers`, no `NovaAgent`, no `LLM_API_KEY` requirement.
5. **No tool calls / no network.** No `fetch`, no `child_process` execution of tasks, no MCP/LSP invocation.
6. **No raw cron parser** internally (deferred — Alternative A2). The cron *manifest* is a static template, not an evaluated expression.
7. **No state schema change** → no `HEARTBEAT_SCHEMA_VERSION` bump, no migration.
8. **No secrets / no absolute paths** in any artifact; placeholders only.
9. **No modification of `docs/heartbeat.md`** in *this* design ADR (it is listed as an implementer touchpoint; the product doc is updated during implementation, not here).

---

## 6. Security & safety analysis

| Threat / concern | Mitigation in this design |
|---|---|
| **Self-scheduling / runaway autonomy** | No timer/daemon APIs anywhere; `plan`/`export` are pure compute + one sandboxed write, then exit. Test plan adds a *static guard* asserting `src/heartbeat/{schedule,planner,automation}.ts` contain no `setInterval`/`setTimeout`/`setImmediate`/`child_process`/`exec`/`spawn`. |
| **Privilege escalation via emitted manifest** | Manifest is inert text with placeholders; it invokes only `tick --dry-run` (itself non-executing). A prominent banner states Nova does not install it. Operator action is required and explicit. |
| **Path traversal / writes outside sandbox** | Every new path goes through `assertPathUnderDir(…, heartbeat.root)`. `--out` is rejected unless it resolves under `.nova/heartbeat/`. Reuses the V1 guard already covering `ticks/` and `locks/`. |
| **Secret / absolute-path leakage** | `safeHeartbeatPlanReport` / `safeHeartbeatAutomationBody` route every emitted artifact through `safeHeartbeatText` (which calls `redactString` + `containsSecretLike`). Config-level secret-like values are still rejected at load by `findForbiddenSecrets`. Manifests use `<PROJECT_DIR>`/`<NOVA_BIN>` — no real paths to leak. |
| **Non-determinism / untestable** | Injected `now`; deterministic `planId` (hash, no wall-clock); no timestamps in manifest bodies; quiet-hour tests pinned to `UTC` (no DST). ICU-version caveat documented; DST timezones used only in non-asserting demonstrations. |
| **Concurrency / partial writes** | `plan` and `export` acquire the existing `withLock` and use the V1 atomic `writeFileAtomic` (temp + rename). `plan` does not touch `state.json`, eliminating read-modify-write races on state. |
| **Blast radius of a failure** | Worst case = a few KB of redacted text under `.nova/heartbeat/{plans,automation}/`. No system mutation, no process left running, no network egress. |
| **Disabled-by-default bypass** | `plan` runs even when disabled but sets `preview: true`, `heartbeatEnabled: false`, and annotates that nothing will run; `export` only emits text. Neither enables anything — only a human editing config to `enabled: true` *and* installing a manifest can cause future `tick --dry-run` invocations, which still execute nothing. |

---

## 7. Schema-version impact & migration

- **`HEARTBEAT_SCHEMA_VERSION`: stays `1`.** Rationale: persisted `HeartbeatState` is byte-shape-identical; `plan` is state-read-only; new artifacts live in their own directories.
- **Project config:** additive optional fields under `.strict()` (`schedule.anchor`, `heartbeat.timezone`, `heartbeat.quietHours`). Old configs parse unchanged; `PROJECT_CONFIG_SCHEMA_VERSION` unchanged.
- **Forward note (NOT in scope now):** *if* a future iteration decides to persist `lastPlanId`/`lastPlanAt` into `HeartbeatState`, that **does** change state shape → bump to `2`. Migration would be trivial because `HeartbeatStore.readState` already defensively reconstructs state field-by-field (missing fields → `undefined`), so a v1 state file is forward-readable and a v2 writer is additive. This ADR deliberately avoids that to keep the iteration tight (C7).

---

## 8. Alternatives considered

### A1 — Internal scheduler / daemon that runs ticks on a timer *(REJECTED)*
A long-running process (or `setInterval`) that fires `tick --dry-run` periodically. **Rejected:** violates C3/C4 outright (autonomy, background process). The whole point is that the *operator's* OS scheduler owns time; Nova only plans and emits.

### A2 — Full 5-field cron expressions as the internal schedule model *(DEFERRED)*
`schedule.type: 'cron'` with a pure cron matcher + DST-correct "next-time" iterator. **Deferred, not rejected:** high cost (cron parser, ranges/steps/lists, and a correct timezone-aware *next-occurrence* iterator across DST) for low marginal value over interval+anchor+quietHours for a *preview/manifest* feature. Because the manifest cadence is decoupled from internal scheduling (D3), we can still emit a cron *manifest* without parsing cron internally. **Migration path if revived:** add `type: 'cron'` as a new additive enum member + a `schedule.cron?: string` field; `projectHeartbeatPlan` gains a cron branch; no breaking change. Documented here so a future ADR can supersede this section only.

### A3 — Structured calendar object (`{minutes:[], hours:[], weekdays:[]}`) instead of anchor+quiet hours *(REJECTED for now)*
Trivially validated by zod and trivially evaluated, more expressive than interval+anchor. **Rejected for this iteration:** larger schema surface and a second projection path to test, for a need (clean cadence + nightly blackout) that interval+anchor+quietHours already meets. Revisit alongside A2 if real demand appears.

### A4 — `automation export` writes directly to the OS scheduler location (`--out /etc/cron.d/...`) *(REJECTED)*
Matches the literal mission flag `--out <path>` but **violates C4** (writes outside `.nova/`). **Resolution:** `--out` is constrained under `.nova/heartbeat/`; the canonical copy lands in the sandbox and is echoed to stdout so the operator redirects it themselves. This keeps the ergonomics of `--out` while honouring the immutable sandbox rule.

### A5 — `plan` mutates `state.json` (records `lastPlanId`) for richer `status` *(REJECTED for now)*
Nicer `status` output, but changes state shape → forces a `HEARTBEAT_SCHEMA_VERSION` bump (C7) and adds a read-modify-write race on state. **Rejected:** `status` can instead read the newest file in `plans/` (mirroring `latestTickReport()`), keeping state immutable and the schema at `1`.

### A6 — Embed a "generated at" timestamp in manifests / plans *(REJECTED)*
Operator-friendly, but breaks byte-determinism and the offline acceptance check. **Rejected:** manifests carry a static provenance comment without a timestamp; the plan records the *injected* `generatedForNow`, which is an input (deterministic), not `Date.now()`.

---

## 9. Consequences

### Positive
- Operators get **deterministic forward visibility** (`plan`) and a **safe, ready-to-edit automation manifest** (`export`) without Nova ever scheduling or executing anything.
- **Zero new dependencies**; all math is epoch arithmetic + read-only `Intl`.
- **No schema bump, no migration**; existing configs/state keep working untouched.
- **Lower blast radius than `tick`**: `plan` is state-read-only and idempotent.
- Manifest export is **decoupled** from the internal schedule model, so the schedule model can evolve (A2/A3) without touching the export contract.

### Negative / trade-offs
- **Less expressive than cron** for now (no "weekdays at 09:00" in one field) — mitigated by interval+anchor+quietHours and a documented migration path (A2).
- **Quiet-hour evaluation depends on ICU/tz data** bundled with Node; cross-Node-version reproducibility for DST edges is not guaranteed — mitigated by pinning deterministic tests to `UTC`.
- **Two new artifact directories** (`plans/`, `automation/`) to maintain and redact — bounded, and they reuse the V1 sandbox + atomic-write + redaction machinery.
- Operators may *expect* `--out` to write anywhere; the sandbox restriction is a deliberate safety choice and must be clearly documented in help text + product doc.

---

## 10. Validation gates (per C8)

```
npm run typecheck
npm run build
npm run cli:smoke
npm run heartbeat:smoke      # extended with plan + automation + back-compat cases
```

Plus the **deterministic acceptance check** (breakdown §Test Plan):
`nova heartbeat plan --now 2026-01-02T00:00:00.000Z --horizon 3h --max 5 --json` over a fixed single-interval config must emit exactly four `would_run` occurrences at `00:00/01:00/02:00/03:00Z`, with a stable `planId` and **no `state.json` mutation**.
