# ADR-001 — Breakdown: Module map, Test plan & Implementer task template

Companion to [`ADR-001-heartbeat-planning-automation.md`](./ADR-001-heartbeat-planning-automation.md). This document is the **implementer-facing contract**: exactly which files change, which exports/types/zod-fields/CLI-rows are added, where artifacts persist, where redaction is applied, how it is tested, and the copy-paste task template with verification commands and out-of-scope.

> **Prime directive:** *extend, never rewrite.* Every change below is **additive**. No existing export is removed or retyped; no existing behaviour changes. Disabled-by-default stays. All writes stay under `.nova/heartbeat/`. zod stays `.strict()`. `HEARTBEAT_SCHEMA_VERSION` stays `1`.

---

## 1. Per-file module breakdown

Legend: **N** = new file · **M** = modified (additive) · all paths under `nova-agent/`.

### 1.1 `src/heartbeat/types.ts` — **M**

| Change | Detail |
|---|---|
| Extend `HeartbeatScheduleConfig` | add `anchor?: string` (ISO-8601; interval-only — enforced at config layer) |
| Extend `HeartbeatConfig` | add `timezone?: string` (IANA, default `"UTC"`), `quietHours?: HeartbeatQuietWindow[]` |
| New type `HeartbeatQuietWindow` | `{ start: string; end: string }` (`"HH:MM"`) |
| New type `HeartbeatPlanTaskStatus` | `'projected' \| 'manual' \| 'skipped' \| 'blocked' \| 'needs_user_action'` (separate enum — **do not** widen `HeartbeatTaskResultStatus`) |
| New type `HeartbeatPlanOccurrence` | `{ at: string; classification: 'would_run' \| 'quiet_hours'; note?: string }` |
| New type `HeartbeatPlanTask` | per §3 of ADR |
| New type `HeartbeatPlanReport` | per §3 of ADR; `schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION` |
| New type `HeartbeatAutomationTarget` | `'windows-task' \| 'systemd' \| 'cron'` |
| New type `HeartbeatAutomationManifest` | per §3 of ADR |
| Unchanged | `HEARTBEAT_SCHEMA_VERSION = 1`; all existing types kept verbatim |

**New exports:** the 6 new types/aliases above. **Changed exports:** none (only field additions to two existing interfaces).

### 1.2 `src/heartbeat/schedule.ts` — **N** (pure, no I/O, no Date.now)

The deterministic math core. **No imports of `fs`, `child_process`, timers, `llm`, `providers`.**

| New export | Signature (design) | Notes |
|---|---|---|
| `parseDurationMinutes` | `(input: string \| number) => number` | grammar `^(\d+)(m\|h\|d)$` or bare int = minutes; throws `HeartbeatScheduleError` on invalid; caps at `MAX_HORIZON_MINUTES` |
| `nextIntervalOccurrence` | `(fromMs: number, everyMin: number, anchorMs?: number) => number` | first occurrence `>= fromMs` on the anchor phase grid; pure modulo arithmetic |
| `projectIntervalOccurrences` | `(opts:{ nowMs; horizonMin; everyMin; anchorMs?; maxPerTask }) => number[]` | inclusive `[now, now+horizon]`; length ≤ `min(maxPerTask, MAX_OCCURRENCES)` |
| `isInQuietHours` | `(epochMs: number, windows: HeartbeatQuietWindow[], timezone: string) => HeartbeatQuietWindow \| null` | only timezone-aware step; uses `Intl.DateTimeFormat(timezone,{hour,minute,hourCycle:'h23'})`; `[start,end)`, start>end wraps midnight |
| `parseClockHHMM` | `(s: string) => { h: number; m: number }` | validates `^([01]\d\|2[0-3]):[0-5]\d$` |
| `validateTimezone` | `(tz: string) => boolean` | `try { new Intl.DateTimeFormat(undefined,{timeZone:tz}); return true } catch { return false }` |
| const `MAX_HORIZON_MINUTES` | `= 366*24*60` | guardrail |
| const `MAX_OCCURRENCES` | `= 1000` | absolute cap per task |
| class `HeartbeatScheduleError extends Error` | — | typed failure for CLI mapping |

### 1.3 `src/heartbeat/planner.ts` — **N** (pure orchestration over schedule.ts + config.ts)

| New export | Signature (design) | Notes |
|---|---|---|
| `projectHeartbeatPlan` | `(args:{ config: HeartbeatConfig; state: HeartbeatState; nowMs: number; horizonMinutes: number; maxPerTask: number; heartbeatId: string }) => HeartbeatPlanReport` | **pure**; no I/O; reuses `classifyHeartbeatTaskSafety` for `blocked`/`needs_user_action`; `manual` schedule → `status:'manual'`, no occurrences; disabled task → `status:'skipped'`; disabled heartbeat → `preview:true`, still projects |
| `computePlanId` | `(report-inputs) => string` | `plan_` + first 16 hex of `sha256(now\|horizon\|max\|timezone\|configDigest)` via `node:crypto`; **no wall-clock/random** |
| `configDigest` | `(config: HeartbeatConfig) => string` | stable JSON (sorted keys) → sha256; lets identical configs share planId |

Anchor precedence implemented here: `schedule.anchor` → `state.tasks[id]?.lastRunAt` → `nowMs`. Occurrence classification: each ms from `projectIntervalOccurrences` → `isInQuietHours` ? `quiet_hours` : `would_run`.

### 1.4 `src/heartbeat/automation.ts` — **N** (pure builder, deterministic bytes)

| New export | Signature (design) | Notes |
|---|---|---|
| `buildAutomationManifest` | `(args:{ target: HeartbeatAutomationTarget; tickEveryMinutes?: number; tickAt?: string; timezone: string }) => HeartbeatAutomationManifest` | dispatches to per-target builder; `invokes` literal = `'nova heartbeat tick --dry-run'`; `installed:false` |
| `renderCronManifest` | internal | `*/N * * * * cd <PROJECT_DIR> && <NOVA_BIN> heartbeat tick --dry-run` (or `M H * * *` for `--at`) |
| `renderSystemdManifest` | internal | `.timer` + `.service` text using `OnCalendar=`/`OnUnitActiveSec=`, `ExecStart=<NOVA_BIN> heartbeat tick --dry-run`, `WorkingDirectory=<PROJECT_DIR>` |
| `renderWindowsTaskManifest` | internal | `schtasks /Create …` **example** command (commented as operator-run) invoking `<NOVA_BIN> heartbeat tick --dry-run` |
| const `AUTOMATION_BANNER` | — | the "operator must install manually / Nova does not schedule itself / dry-run only" header, prefixed as comments per target |
| `defaultTickEveryMinutes` | `(config) => number` | `min(everyMinutes of safe enabled interval tasks)` clamped `[5,1440]`, fallback `15` |

**Placeholders only:** `<PROJECT_DIR>`, `<NOVA_BIN>`. **No timestamp** in body (determinism). **No absolute paths.**

### 1.5 `src/heartbeat/config.ts` — **M**

| Change | Detail |
|---|---|
| `resolveHeartbeatConfig` | also normalize `timezone` (default `"UTC"`, validate via `validateTimezone`, invalid → usage error) and `quietHours` (validate each `start`/`end` via `parseClockHHMM`) |
| `normalizeHeartbeatSchedule` | carry through `anchor` for interval; ignore/strip `anchor` for `manual` (defensive — config layer already forbids) |
| Reuse unchanged | `classifyHeartbeatTaskSafety`, `isHeartbeatDangerousKind`, `SAFE_KINDS/ACTIONS`, `DANGEROUS` — planner consumes these as-is |

No new safety categories. Planner maps existing safety verdicts → plan statuses (`blocked`/`needs_user_action`).

### 1.6 `src/heartbeat/paths.ts` — **M**

| New export | Detail |
|---|---|
| `heartbeatPlansDir(root)` | `<root>/plans`, guarded by `assertPathUnderDir` |
| `heartbeatPlanPaths(root, planId)` | `{ json: plans/<planId>.json, markdown: plans/<planId>.md }` |
| `heartbeatAutomationDir(root)` | `<root>/automation` |
| `heartbeatAutomationPath(root, target)` | `automation/<target>.txt` |
| `resolveAutomationOutPath(root, relOut)` | resolve `--out` then `assertPathUnderDir(_, root)`; throw if escapes |

`heartbeatPaths()` extended to also expose `plansDir`/`automationDir`. Every helper funnels through the existing `assertPathUnderDir` guard.

### 1.7 `src/heartbeat/store.ts` — **M**

| Change | Detail |
|---|---|
| `ensure()` | additionally `mkdir -p` `plans/` and `automation/` |
| New `writePlanReport(report)` | atomic `writeFileAtomic` JSON + markdown to `heartbeatPlanPaths`; under `withLock`; **does not touch `state.json`** |
| New `latestPlanReport()` | newest file in `plans/` (mirror of `latestTickReport()`) for a future `status` read; read-only |
| New `writeAutomationManifest(manifest, outPath?)` | atomic write to sandbox path (default `automation/<target>.txt`, or validated `--out`); under `withLock` |
| Unchanged | `readState`/`writeState`/`withLock`/`writeFileAtomic` kept verbatim; `readState` stays defensively reconstructive (forward-compatible if state ever bumps to v2) |

### 1.8 `src/heartbeat/redaction.ts` — **M**

| New export | Detail |
|---|---|
| `safeHeartbeatPlanReport(report)` | deep-clone, route every string field (reasons, notes, ids, paths) through `safeHeartbeatText`/`safeHeartbeatPath`; assert `secretsIncluded:false` |
| `safeHeartbeatPlanTask(task)` | per-task helper used by the above |
| `safeHeartbeatAutomationBody(body)` | run manifest text through `safeHeartbeatText`; verify no absolute path / secret survives; placeholders preserved |
| Reuse | existing `safeHeartbeatText` → `redactString` (`src/policy/redact.ts`) + `containsSecretLike` (`src/memory/redaction.ts`) |

**Redaction touchpoints (every emitted byte):** `writePlanReport` input ← `safeHeartbeatPlanReport`; `--json` stdout ← same redacted object; markdown render ← redacted report; `writeAutomationManifest` input ← `safeHeartbeatAutomationBody`; `--stdout` echo ← same.

### 1.9 `src/heartbeat/reporter.ts` — **M**

| New export | Detail |
|---|---|
| `renderHeartbeatPlanMarkdown(report)` | header (planId, now, horizon, tz, enabled/preview), per-task table (id · kind · status · firstDueAt · #occurrences), occurrence list with `would_run`/`quiet_hours`, and the standing safety footer (`no LLM · no tools · no execution · no scheduler installed`) |
| Reuse | existing `renderHeartbeatMarkdown` untouched |

### 1.10 `src/heartbeat/index.ts` — **M**

| Change | Detail |
|---|---|
| `handleHeartbeatCommand` switch | add `case 'plan'` and `case 'automation'` (with sub-arg `export`) **after** existing `validate/status/tasks/tick/report` cases |
| `handleHeartbeatPlan(args)` | parse `--now/--horizon/--max/--json`; load config+state (read-only); `projectHeartbeatPlan`; `safeHeartbeatPlanReport`; `store.writePlanReport`; print redacted JSON or markdown |
| `handleHeartbeatAutomationExport(args)` | parse `--target/--every/--at/--stdout/--out/--json`; `buildAutomationManifest`; `safeHeartbeatAutomationBody`; `--stdout` → print only; else `store.writeAutomationManifest` + echo |
| Re-exports | add `projectHeartbeatPlan`, `buildAutomationManifest`, `renderHeartbeatPlanMarkdown`, new types (barrel) |
| Errors | reuse existing `heartbeatUsageError(message)` helper (returns `true`, exit 1) for bad flags, escaping `--out`, invalid `--target`, invalid duration/timezone — same pattern as V1 |

No change to dispatch order in `src/index.ts` (help handled before heartbeat already). No new top-level command.

### 1.11 `src/config/project.ts` — **M** (zod, stays `.strict()`)

| Change | Detail |
|---|---|
| schedule object | add `anchor: z.string().datetime().optional()`; add `.superRefine` → if `type==='manual'` and `anchor` present → issue (`anchor only valid for interval`) |
| heartbeat object | add `timezone: z.string().refine(validateTimezone,'invalid IANA timezone').optional()` |
| heartbeat object | add `quietHours: z.array(z.object({ start: hhmm, end: hhmm }).strict()).optional()` where `hhmm = z.string().regex(/^([01]\d\|2[0-3]):[0-5]\d$/)` |
| Keep | `.strict()` on every object; existing `findForbiddenSecrets` secret rejection; duplicate-id refine; **do not** bump `PROJECT_CONFIG_SCHEMA_VERSION` |

All additions optional ⇒ existing configs validate unchanged.

### 1.12 `src/cli/help.ts` — **M**

Add to `heartbeatHelp()` (after the `tick`/`report` rows):

```
  nova heartbeat plan [--now <iso>] [--horizon <dur>] [--max <N>] [--json]
      Project upcoming task occurrences within a horizon (read-only, no execution).
      Writes a redacted plan to .nova/heartbeat/plans/. Default horizon 24h, max 10.

  nova heartbeat automation export --target <windows-task|systemd|cron>
                                   [--every <dur> | --at <HH:MM>] [--stdout]
                                   [--out <relpath-under-.nova>] [--json]
      Emit an operator-installable manifest that runs `nova heartbeat tick --dry-run`.
      Nova never installs it and never schedules itself. Output stays under .nova/heartbeat/.
```

`heartbeat --help` must remain **exit 0** and contain the literal `nova heartbeat tick --dry-run`.

### 1.13 `docs/heartbeat.md` — **implementer touchpoint only (NOT edited by this ADR)**

Implementer adds a "Planning & Automation" section documenting `plan`/`automation export`, the sandbox-only `--out` rule, and the determinism/`--now` contract. *Out of scope for the design ADR; listed here so it is not forgotten during implementation.*

---

## 2. Test plan

All tests deterministic, offline, no network/LLM/tools. Runner = existing `node:assert/strict` + `spawnSync` `runNova` harness used by `src/heartbeat/smoke.ts` (no jest/pytest).

### 2.1 Unit — schedule math (fixed clock) → `schedule` cases

| Case | Input | Expected |
|---|---|---|
| duration parse | `"90m"`, `"24h"`, `"7d"`, `"45"` | `90`, `1440`, `10080`, `45` |
| duration invalid | `"5w"`, `"-3h"`, `"h"`, `""` | throws `HeartbeatScheduleError` |
| next occurrence, no anchor | `from=00:07Z`, every `15` | `00:15Z` (ceil to grid from `from`) |
| next occurrence, anchored | `from=00:07Z`, every `60`, anchor `00:00Z` | `01:00Z` (phase grid) |
| projection inclusive bounds | `now=00:00Z`, horizon `180m`, every `60`, anchor `00:00Z`, max `5` | `[00:00,01:00,02:00,03:00]Z` (both ends inclusive) |
| projection max cap | every `1`, horizon `24h`, max `10` | length `10` |
| quiet hours simple | `01:30Z`, window `01:00–02:00`, tz `UTC` | returns the window |
| quiet hours boundary | `02:00Z`, window `01:00–02:00` | `null` (end exclusive) |
| quiet hours wrap midnight | `23:30Z`, window `22:00–06:00` | returns the window |
| timezone validate | `"UTC"`, `"Europe/Paris"`, `"Not/Real"` | `true,true,false` |

### 2.2 Unit — plan classification → `planner` cases

| Case | Config/state | Expected `status` / fields |
|---|---|---|
| interval safe enabled | `kind:inspection, interval 60` | `projected`, occurrences non-empty, all `would_run` |
| occurrence in quiet window | above + quietHours covering one slot | that occurrence `quiet_hours`, others `would_run` |
| manual schedule | `type:manual` | `manual`, occurrences `[]` |
| disabled task | task `enabled:false` | `skipped`, occurrences `[]` |
| dangerous kind | `kind:shell` / action `write` | `blocked`, occurrences `[]` |
| unknown action | action not in SAFE/DANGEROUS | `needs_user_action`, occurrences `[]` |
| heartbeat disabled | `heartbeat.enabled:false` | report `preview:true`, `heartbeatEnabled:false`, tasks still projected |
| anchor precedence | task with `lastRunAt` **and** `schedule.anchor` | grid follows `anchor` (not `lastRunAt`) |
| determinism of planId | same inputs twice | identical `planId` |
| counts integrity | mixed config | `counts.*` sum matches `tasks.length` & occurrence total |

### 2.3 Unit — automation manifest content → `automation` cases

| Case | Expected |
|---|---|
| cron `--every 15m` | body contains `*/15 * * * *` and `nova heartbeat tick --dry-run` and `<PROJECT_DIR>`/`<NOVA_BIN>` |
| cron `--at 02:30` | body contains `30 2 * * *` |
| systemd | contains `[Timer]`, `ExecStart=<NOVA_BIN> heartbeat tick --dry-run`, `WorkingDirectory=<PROJECT_DIR>` |
| windows-task | contains `schtasks /Create` and `heartbeat tick --dry-run` |
| invariants | `installed === false`, `invokes === 'nova heartbeat tick --dry-run'` |
| banner present | every target body contains the "Nova does not schedule itself" banner |
| no leakage | body matches no absolute-path / secret pattern (assert via `containsSecretLike` + `/^([A-Za-z]:\\|\/)/m` negative) |
| determinism | same flags → identical bytes (no timestamp) |

### 2.4 Unit — backward compatibility

| Case | Expected |
|---|---|
| V1 config (no `timezone`/`quietHours`/`anchor`) | parses; `resolveHeartbeatConfig` defaults `timezone:"UTC"`, `quietHours:[]` |
| V1 `state.json` (schemaVersion 1) | `readState` loads unchanged; `plan` does **not** rewrite it |
| `.strict()` extra key | unknown config key still rejected |
| `anchor` on `manual` | zod `superRefine` rejects |
| existing `tick --dry-run` | identical output/exit to pre-change (golden compare) |

### 2.5 `src/heartbeat/smoke.ts` — extension (CLI end-to-end via `runNova`)

Add cases (keep all existing ones green):

1. `heartbeat --help` → exit 0, contains `nova heartbeat plan` **and** `nova heartbeat tick --dry-run`.
2. `heartbeat plan --now <fixed> --horizon 3h --max 5 --json` → exit 0; JSON parses; `safety.{llmInvoked,toolsInvoked,autonomousActionsExecuted,schedulerInstalled} === false`.
3. **State immutability:** capture `state.json` mtime+bytes before/after `plan` → unchanged.
4. `heartbeat automation export --target cron --every 15m --stdout` → exit 0; stdout contains `*/15 * * * *` + `tick --dry-run` + banner; **no file written**.
5. `heartbeat automation export --target systemd` → writes `.nova/heartbeat/automation/systemd.txt`; bytes deterministic on re-run.
6. **Sandbox guard:** `automation export --target cron --out ..\..\evil.txt` → exit 1, usage error, **no file outside `.nova/`**.
7. **Static autonomy guard:** read `schedule.ts`/`planner.ts`/`automation.ts` sources; assert they contain none of `setInterval|setTimeout|setImmediate|child_process|\.exec\(|spawn(`.
8. Plan when `heartbeat.enabled:false` → `preview:true`, exit 0, nothing executed.

### 2.6 Deterministic acceptance check (headline gate)

**Fixture** (ephemeral temp project): `heartbeat.enabled:true`, `timezone:"UTC"`, one task `{ id:"inspect-langs", kind:"inspection", action:"inspect", schedule:{ type:"interval", everyMinutes:60, anchor:"2026-01-02T00:00:00.000Z" } }`, no `lastRunAt`, no quiet hours.

**Command:**
```
nova heartbeat plan --now 2026-01-02T00:00:00.000Z --horizon 3h --max 5 --json
```

**Assert exactly:**
- exit code `0`
- `tasks.length === 1`, `tasks[0].status === "projected"`
- `tasks[0].occurrences.map(o => o.at)` **===**
  `["2026-01-02T00:00:00.000Z","2026-01-02T01:00:00.000Z","2026-01-02T02:00:00.000Z","2026-01-02T03:00:00.000Z"]`
- every occurrence `classification === "would_run"`
- `safety.llmInvoked===false && safety.toolsInvoked===false && safety.autonomousActionsExecuted===false && safety.schedulerInstalled===false`
- re-running the exact command → **identical `planId`** and identical occurrence bytes
- `state.json` byte-identical before/after

---

## 3. Implementer task template

> Copy-paste into the implementation ticket. Do not deviate from OUT-OF-SCOPE.

### Title
`heartbeat: add planning-only projection (plan) + operator automation manifest export (V2)`

### Scope (do exactly this)
1. Extend types (`types.ts`) additively per Breakdown §1.1.
2. Add pure `schedule.ts` (§1.2) and `planner.ts` (§1.3) — no I/O, no timers, no Date.now in core.
3. Add pure `automation.ts` (§1.4) — placeholder bodies, deterministic, banner.
4. Extend `config.ts` (§1.5), `paths.ts` (§1.6), `store.ts` (§1.7), `redaction.ts` (§1.8), `reporter.ts` (§1.9), `index.ts` (§1.10) — all additive.
5. Extend zod in `config/project.ts` (§1.11) — optional fields, keep `.strict()`, no schema-version bump.
6. Extend `cli/help.ts` (§1.12) with the two help blocks.
7. Extend `heartbeat/smoke.ts` (§2.5) and add unit cases (§2.1–2.4) and the acceptance check (§2.6).
8. Update `docs/heartbeat.md` with a Planning & Automation section (§1.13).

### Files (touch only these)
```
src/heartbeat/types.ts        (M)   src/heartbeat/paths.ts       (M)
src/heartbeat/schedule.ts     (N)   src/heartbeat/store.ts       (M)
src/heartbeat/planner.ts      (N)   src/heartbeat/redaction.ts   (M)
src/heartbeat/automation.ts   (N)   src/heartbeat/reporter.ts    (M)
src/heartbeat/config.ts       (M)   src/heartbeat/index.ts       (M)
src/heartbeat/smoke.ts        (M)   src/config/project.ts        (M)
src/cli/help.ts               (M)   docs/heartbeat.md            (M, product doc)
```

### Acceptance criteria
- [ ] `nova heartbeat plan` projects occurrences read-only; **never** mutates `state.json`.
- [ ] Deterministic acceptance check (§2.6) passes exactly, including stable `planId` and byte-identical re-run.
- [ ] `nova heartbeat automation export` emits inert, placeholderized, banner-headed manifests invoking only `tick --dry-run`; writes only under `.nova/heartbeat/automation/` (or `--stdout`).
- [ ] `--out` escaping `.nova/heartbeat/` is rejected (exit 1, no file written).
- [ ] Every emitted artifact passes redaction (no secret, no absolute path); static autonomy guard (§2.5.7) passes.
- [ ] V1 unchanged: existing configs/state parse; `tick --dry-run` golden output identical; `heartbeat --help` exit 0 contains `nova heartbeat tick --dry-run`.
- [ ] zod stays `.strict()`, all new fields optional; `HEARTBEAT_SCHEMA_VERSION` still `1`; `PROJECT_CONFIG_SCHEMA_VERSION` unchanged.
- [ ] No new runtime dependency added to `package.json`.

### Verification commands (run all; all must pass)
```
npm run typecheck        # tsc --noEmit — no type errors
npm run build            # tsc — compiles
npm run cli:smoke        # existing CLI smoke stays green
npm run heartbeat:smoke  # extended heartbeat smoke (incl. plan/automation/back-compat/guards)
```
Plus the determinism gate (scripted inside `heartbeat:smoke`, or run manually in a temp project):
```
nova heartbeat plan --now 2026-01-02T00:00:00.000Z --horizon 3h --max 5 --json
# assert occurrences == 00:00/01:00/02:00/03:00Z, all would_run, planId stable, state.json unchanged
```

### OUT-OF-SCOPE (do NOT do — instant rejection)
- ❌ Any daemon / `setInterval` / `setTimeout` / `setImmediate` / background loop / self-scheduling.
- ❌ Registering any OS scheduler (`schtasks /Create`, `systemctl enable`, `crontab` write) — emit text only.
- ❌ Any live task execution, LLM call, tool call, or network access.
- ❌ Writing anywhere outside `.nova/heartbeat/` (including via `--out`).
- ❌ Bumping `HEARTBEAT_SCHEMA_VERSION` or `PROJECT_CONFIG_SCHEMA_VERSION`; changing `HeartbeatState` shape.
- ❌ Adding `schedule.type:'cron'` / an internal cron parser (deferred — ADR §A2).
- ❌ Making `plan` mutate state (ADR §A5); embedding timestamps in plan/manifest bodies (ADR §A6).
- ❌ Removing/retyping any existing export or changing V1 behaviour.
- ❌ Adding a runtime dependency.

---

## 4. Traceability to DoD

| DoD item | Where satisfied |
|---|---|
| ADR with context/decision/alternatives/consequences/NON-GOALS/security/schema impact+migration | `ADR-001-heartbeat-planning-automation.md` §1–10 |
| Sibling per-file module breakdown (targets, exports, types, zod, CLI+help, persistence, redaction) | this doc §1 |
| Test plan (schedule math fixed clock, plan classification, manifest content, back-compat) + smoke extension + deterministic acceptance | this doc §2 |
| Implementer task template (scope, files, acceptance, exact verification cmds, OUT-OF-SCOPE) | this doc §3 |
| Immutable constraints (extend, disabled-by-default, sandbox-only, zod strict additive, redaction everywhere) | ADR C1–C9 + §5/§6; this doc §1/§3 |
| No `src/` writes; no secrets/.env/.nova printed | both docs are design-only; nothing under `src/` touched |
