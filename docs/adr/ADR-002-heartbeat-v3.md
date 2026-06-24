# ADR-002 — Heartbeat V3 (gated real execution of autonomous tasks, disabled-by-default, fail-closed)

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Architecture (draft) → Orchestrator/CTO (accepted 2026-06-23)
- **Scope:** `src/heartbeat/**` (extends; adds `execution_gate.ts`, `executor.ts`), `src/sandbox/**` (NEW shared capability — interface + fail-closed probe only), reuses `src/tools/registry.ts`, `src/approval/**`, `src/policy/**`, `src/agent.ts`. **No process spawn is added under `src/heartbeat/**`.**
- **Supersedes:** none. **Extends** [`ADR-001`](./ADR-001-heartbeat-planning-automation.md) (Heartbeat V2). **Reworks** ADR-001 §6 static guard (ADR-001:226). **Consumes** ADR-001 §7 schema-bump pre-authorization (ADR-001:241).
- **Companion:** this file embeds the per-slice breakdown (§11) and per-slice implementer task templates (§12).

> This iteration is **Heartbeat V3 "gated real execution"**. It is an *additive extension* of Heartbeat V1 (dry-run ticks) and V2 (planning/automation). V1/V2 guarantees are preserved verbatim. **The execution sandbox is DESIGNED here, NOT implemented.** With the master flag `NOVA_ENABLE_HEARTBEAT_EXEC` unset (the default), heartbeat behaviour is byte-identical to V2: it executes nothing, starts no daemon, calls no LLM, calls no tool, touches no network. Package version stays **0.1.0**; only the internal `HEARTBEAT_SCHEMA_VERSION` advances (1 → 2).

---

## 1. Context

### 1.1 Problem

Heartbeat V1/V2 can *classify* and *project* maintenance tasks but **deliberately never executes one**. The roadmap defers real execution behind two hard prerequisites that are now partially met:

- `ROADMAP.md:43` — **Approval Manager V1 is delivered** (`src/approval/manager.ts`: `request` / `list` / `decide`).
- `ROADMAP.md:77` — real heartbeat execution is allowed **only after approvals *and* an execution sandbox** exist.
- `ROADMAP.md:125` — the **execution sandbox is still open** (no isolation primitive exists; the only sandbox today is the filesystem path-jail `assertPathUnderDir`).

So one prerequisite (approvals) exists and one (sandbox) does not. V3 must therefore design the *full* execution path **without** lighting it up: every safety gate is wired and tested, but the missing sandbox keeps execution **fail-closed and unreachable** until a later, isolated slice supplies it.

### 1.2 What is missing

1. **A safe decision layer** that answers "may this configured task run *for real* on this externally-invoked tick?" with a single, auditable, **fail-closed** verdict.
2. **A capability boundary** (sandbox) so that if/when a task does run, it runs isolated — reusable beyond heartbeat (notably by `bashTool`, which today spawns with the full parent env, `src/tools/builtin/bash.ts:116`).
3. **A cross-tick approval handshake** that works with **single-shot** ticks (no daemon) and **never lets Nova approve its own execution**.

### 1.3 Forces & constraints (all HARD / immutable — verbatim from mandate)

| # | Constraint | Source |
|---|---|---|
| C1 | **Triple gate, AND-composed, default OFF.** Real execution requires *(a)* env flag **AND** *(b)* a granted approval **AND** *(c)* an active sandbox capability. Missing any ⇒ dry-run or refuse. | Mandate |
| C2 | **Dedicated flag `NOVA_ENABLE_HEARTBEAT_EXEC`** (accepts `'1'`/`'true'`, OFF by default), **AND-composed** with the existing `NOVA_ENABLE_LIVE_LLM` / `NOVA_ENABLE_WRITE_TOOLS` capability flags. | Mandate |
| C3 | **Gate (c) is fail-closed.** With no sandbox implementation present, **REFUSE** even when the flag is ON and an approval is granted. | Mandate |
| C4 | **Delegate execution via `NovaAgent` / `ToolRegistry`** (inherits policy + approval + redaction). **No `child_process` / `spawn` inside `src/heartbeat/**`** (would trip the ADR-001:226 static guard). | Mandate |
| C5 | **No daemon / self-loop.** Ticks stay externally-invoked and single-shot; operator manifests stay `installed=false`. | ADR-001 C3 / Mandate |
| C6 | **Writes only under `.nova/heartbeat/`**; metadata-only redacted reports; no secrets, no absolute paths. | V1 / Mandate |
| C7 | **Stack immutable** — Vercel AI SDK + zod; no new runtime dependency unless explicitly justified. | Mandate |
| C8 | **Bump `HEARTBEAT_SCHEMA_VERSION` only with migration notes**; additive, forward-readable. | ADR-001 C7 / :241 |
| C9 | **Determinism / offline-testability** for the whole decision layer (no real shell/LLM/network in the gate). | ADR-001 C9 |
| C10 | **Package version stays `0.1.0`.** | Mandate |

### 1.4 Existing surface this builds on (verified `file:line` facts — must remain compatible)

- `src/heartbeat/types.ts:1` — `HEARTBEAT_SCHEMA_VERSION = 1`.
- `src/heartbeat/types.ts:28-32` — `HeartbeatTaskState { lastRunAt?, lastDryRunAt?, lastStatus? }`. **`lastRunAt` exists but is never written today** (only `lastDryRunAt` is stamped).
- `src/heartbeat/runner.ts:22` — insertion point: end of the `planHeartbeatTask` per-task map (where a verdict is finalized).
- `src/heartbeat/runner.ts:29` — report literal **`dryRun: true`** (plus `safety.*` all-`false` literals) — the literal→boolean widening site.
- `src/heartbeat/runner.ts` (`nextState`, ~`:91`) — currently never writes `lastRunAt`.
- `src/heartbeat/config.ts:4-6` — `SAFE_KINDS = {inspection, eval, batch-dry-run, maintenance}`, `SAFE_ACTIONS = {inspect, eval, batch-dry-run, maintain}`, `DANGEROUS = {shell, write, git, network, memory-write, auto-resume}`; `classifyHeartbeatTaskSafety()` → `{ status: 'ok' | 'blocked' | 'needs_user_action', reason }`.
- `src/approval/manager.ts` — `decide(input)` **throws `Approval is not pending: <id>`** unless `status === 'pending'`; `list(status?)`. `ApprovalDecisionInput = { approvalId, decision: 'approved' | 'denied', decidedBy?, reason? }`.
- `src/session/types.ts:9` — `ApprovalDecision = 'pending' | 'approved' | 'denied' | 'expired'`; `RunResumeMetadata.autoExecuteApprovedActions: false`.
- `src/tools/registry.ts:47` — `toAITools({ trace?, policy?, constraints? })`; `:177` default profile `'readonly'`; `:182` capability inferred `def.capability ?? (def.readOnly === false ? 'write' : 'read')`; **`:191-193` — a `'ask'` decision is widened to `'allow'` iff `approvalProvided === true`**; `:194-196` — otherwise `'ask'` ⇒ blocked.
- `src/approval/policy_bridge.ts:6` — `createApprovalPolicyHook(config, active)`; `:9-22` — on `'ask'` it calls `SessionRunManager.requestApproval(...)` then returns the decision. **This is the inherited approval seam.**
- `src/agent.ts` — `NovaAgent` runs on the Vercel AI SDK (`generateText` / `streamText`), drives `ToolRegistry`, and installs `createApprovalPolicyHook`. **This is the delegation target.**
- `src/tools/builtin/bash.ts:116` — spawns child processes with the **full parent env**; constants `DEFAULT_TIMEOUT_MS=30_000`, `MAX_TIMEOUT_MS=300_000`, `DEFAULT_MAX_OUTPUT_CHARS=20_000`, `MAX_OUTPUT_CHARS=200_000`, `KILL_GRACE_MS=1_000`. **The sandbox interface mirrors this surface so `bashTool` can later run *through* it.**
- `src/index.ts:285` & `src/eval/runner.ts:105` — `NOVA_ENABLE_WRITE_TOOLS === '1' || === 'true'` gates **registration** of write/shell tools (`src/security/read_only_matrix.ts:425,437`).
- `src/llm/provider.ts:61` — `NOVA_ENABLE_LIVE_LLM` gates live provider calls (same `'1'|'true'` predicate).
- `ADR-001:226` — static guard: heartbeat modules contain no `setInterval`/`setTimeout`/`setImmediate`/`child_process`/`exec`/`spawn`.
- `ADR-001:241` — **pre-authorizes** the bump to schema `2` when state shape changes; `HeartbeatStore.readState` reconstructs state field-by-field ⇒ a v1 file is forward-readable.

---

## 2. Decision

Add a **fail-closed triple-gate execution layer** to heartbeat, expressed as a **pure decision function** over injected inputs, plus a **shared sandbox capability interface** (designed, not implemented), plus **outward delegation** to the existing `ToolRegistry`/`NovaAgent` for any real work. No new runtime dependency (C7).

### D1 — Triple-gate execution model (AND-composed, default OFF)

Real execution requires **all three** gates true:

- **Gate A — flags.** `NOVA_ENABLE_HEARTBEAT_EXEC` (new master switch, default OFF) **AND** the capability flags a task actually needs:
  `gateA = exec ∧ (¬needsLlm ∨ liveLlm) ∧ (¬needsWrite ∨ writeTools)`,
  where `exec/liveLlm/writeTools` each use the existing predicate `v === '1' || v === 'true'`. Because `NOVA_ENABLE_HEARTBEAT_EXEC` defaults unset, **Gate A is false by default** ⇒ the whole model is OFF (C1, C2).
- **Gate B — approval.** A granted approval (`ApprovalDecision === 'approved'`) matching the task's persisted `pendingApprovalId` (§D7).
- **Gate C — sandbox.** `probeExecutionSandbox()?.available === true`. **Today this is always `false`** (§D3) ⇒ Gate C fail-closed (C3).

#### Truth table (precedence: A → C → B)

| # | A (flag) | B (approval) | C (sandbox) | Outcome | Deciding gate |
|---|:---:|:---:|:---:|---|---|
| 1 | 0 | 0 | 0 | `dry_run` | A off ⇒ V2-identical |
| 2 | 0 | 0 | 1 | `dry_run` | A off dominates |
| 3 | 0 | 1 | 0 | `dry_run` | A off dominates |
| 4 | 0 | 1 | 1 | `dry_run` | A off dominates |
| 5 | 1 | 0 | 0 | **`refused`** | **C fail-closed** |
| 6 | 1 | 0 | 1 | `needs_user_action` | B (request/await approval) |
| 7 | 1 | 1 | 0 | **`refused`** | **C fail-closed — even with approval (C3)** |
| 8 | 1 | 1 | 1 | `execute` | A ∧ B ∧ C |

**Today's reachable set:** with the sandbox absent (`C ≡ 0`) only rows **1–5, 7** occur; rows 6 and 8 are unreachable until the sandbox slice. With default flags (`A ≡ 0`) only rows **1–4** occur ⇒ **always `dry_run` ⇒ ZERO default-behaviour change** (C1).

### D2 — Pure decision function (shape & location)

A new **pure, offline** module `src/heartbeat/execution_gate.ts` (no I/O, no timers, no spawn):

```ts
export type HeartbeatExecutionMode = 'dry_run' | 'needs_user_action' | 'refused' | 'execute';

export interface HeartbeatExecutionGateInput {
  flags:     { heartbeatExec: boolean; liveLlm: boolean; writeTools: boolean };  // Gate A
  taskNeeds: { llm: boolean; write: boolean };                                   // from kind/action
  approval:  { status: 'none' | 'pending' | 'approved' | 'denied' | 'expired'; approvalId?: string }; // Gate B
  sandbox:   { available: boolean };                                             // Gate C — probeExecutionSandbox()
  safety:    { status: 'ok' | 'blocked' | 'needs_user_action' };                 // classifyHeartbeatTaskSafety()
}

export interface HeartbeatExecutionDecision {
  mode: HeartbeatExecutionMode;
  gate: { a: boolean; b: boolean; c: boolean };
  reason: string;          // redaction-safe, metadata-only
  decidedBy: 'task-safety' | 'gate-a-flags' | 'gate-c-sandbox' | 'gate-b-approval' | 'all-gates';
}

export function decideHeartbeatExecution(input: HeartbeatExecutionGateInput): HeartbeatExecutionDecision;
```

Called from `src/heartbeat/runner.ts:22` (after `planHeartbeatTask`, before `nextState`). **Defensive pre-empt:** if `safety.status !== 'ok'` the function never returns `execute` (DANGEROUS kinds are already `blocked`/`needs_user_action` upstream — §D6). The function is a total map over its inputs ⇒ the 8-row truth table is an exhaustive unit test (C9).

### D3 — Gate C is fail-closed (sandbox absent ⇒ refuse)

`probeExecutionSandbox()` (in shared `src/sandbox/`) returns **`null` for the entirety of this ADR's implementation** ⇒ `sandbox.available = false` ⇒ rows 5/7 ⇒ **`refused`**. This is the literal realization of C3: turning on the flag and granting an approval is **not** sufficient; the missing sandbox refuses every execution by construction. Lighting up Gate C is a *separate, later slice* (§11 Slice 3).

### D4 — Shared sandbox capability interface (designed, **not** implemented; reusable for `bashTool`)

Interface lives in **`src/sandbox/types.ts`** — *outside* `src/heartbeat/**` so (a) the reworked static guard can keep heartbeat spawn-free (§D5) and (b) it is obviously reusable by `bashTool`. Its shape mirrors `bash.ts` so a later refactor can route `bashTool` through it:

```ts
// src/sandbox/types.ts — NEW (shared capability, no implementation here)
export interface SandboxExecRequest {
  command: string;
  args?: string[];
  cwd: string;                    // MUST resolve under an allowed root (src/policy/path.ts)
  env?: Record<string, string>;   // ALLOW-LIST only — never `...process.env` (contrast bash.ts:116)
  timeoutMs?: number;             // default 30_000, hard cap 300_000   (mirror bash.ts)
  maxOutputChars?: number;        // default 20_000, hard cap 200_000   (mirror bash.ts)
  killGraceMs?: number;           // default 1_000                       (mirror bash.ts)
}
export interface SandboxExecResult {
  stdout: string; stderr: string; exitCode: number | null;
  timedOut: boolean; truncated: boolean; durationMs: number;
}
export interface ExecutionSandbox {
  readonly id: string;
  readonly available: boolean;    // Gate C probe surface
  exec(request: SandboxExecRequest): Promise<SandboxExecResult>;
}

// src/sandbox/probe.ts — NEW, fail-closed default (no spawn, returns null)
export function probeExecutionSandbox(): ExecutionSandbox | null { return null; }
```

The interface is **generic** (a `command`/`args` executor), not heartbeat-specific — that is the point: `bashTool` becomes a *consumer* of `ExecutionSandbox` in a future refactor, centralizing isolation and the env allow-list.

### D5 — Delegate execution outward; rework the ADR-001:226 static guard

When (and only when) the gate returns `execute`, the work is performed by **delegating to `NovaAgent` / `ToolRegistry`**, never by spawning inside heartbeat (C4):

```ts
registry.toAITools({
  constraints: { allowed: toolsForKind(task.kind) },        // PERMITTED capability set only
  policy: {
    enabled: true,
    profileId: 'readonly',                                  // registry.ts:177 default; writes still 'ask'
    actor, delegation,
    hook: createApprovalPolicyHook(sessionConfig, active),  // policy_bridge.ts:6 — inherited approval
    approvalProvided: true,                                 // registry.ts:191 widens 'ask' → 'allow'
  },
});
```

Any shell capability invoked *inside* that delegated run uses the injected `ExecutionSandbox` (D4) — so the only process spawn in the system lives behind the sandbox implementation in `src/sandbox/**`, **never** under `src/heartbeat/**`.

**Reworked guard (supersedes ADR-001:226):** extend the static guard from `src/heartbeat/{schedule,planner,automation}.ts` to **all of `src/heartbeat/**`** (now including `execution_gate.ts`, `executor.ts`), asserting **no** `setInterval`/`setTimeout`/`setImmediate`/`while(true)` **and no** `child_process`/`node:child_process`/`exec`/`execFile`/`spawn` import or call. The guard becomes **stronger**, not weaker: V3 adds execution *capability* while keeping the heartbeat package itself spawn-free and timer-free.

### D6 — Action taxonomy per task kind (PERMITTED / FORBIDDEN), mapped to `classifyHeartbeatTaskSafety`

| kind (`config.ts:4-6`) | action | `classifyHeartbeatTaskSafety` | V3 disposition | May reach `execute`? |
|---|---|---|---|:---:|
| `inspection` | `inspect` | `ok` | **PERMITTED** — read-capability tools only | yes (triple gate) |
| `eval` | `eval` | `ok` | **PERMITTED** — eval harness | yes (triple gate) |
| `batch-dry-run` | `batch-dry-run` | `ok` | **PERMITTED** — nested dry-runs, no mutation | yes (triple gate) |
| `maintenance` | `maintain` | `ok` | **PERMITTED** — bounded; any write still policy-`ask` | yes (triple gate) |
| `shell` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |
| `write` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |
| `git` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |
| `network` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |
| `memory-write` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |
| `auto-resume` | — | `blocked`/`needs_user_action` | **FORBIDDEN in V3** | **no** |

`classifyHeartbeatTaskSafety` short-circuits every DANGEROUS kind to `blocked`/`needs_user_action` **before** the execution gate, so the gate only ever evaluates `safety.status === 'ok'` (the PERMITTED set). **Double layer:** even within PERMITTED execution, the delegated `ToolRegistry` policy uses profile `'readonly'` (registry.ts:177) ⇒ any `write`/`shell` capability becomes `'ask'` (registry.ts:182,194) which needs the granted approval (registry.ts:191), itself backstopped by tool-registration gating (`NOVA_ENABLE_WRITE_TOOLS`, index.ts:285). A `maintenance` task therefore cannot silently write.

### D7 — Approval semantics across single-shot ticks

**Nova never calls `decide()`.** The heartbeat runner only **creates** and later **reads** approvals; the human operator decides out-of-band. This preserves "no self-approval / no autonomy" and is structurally compatible with single-shot ticks (no daemon, C5):

- **Tick N (row 6, `A ∧ C ∧ ¬B`):** create a pending approval (via the existing session/approval machinery), persist `pendingApprovalId` + `pendingApprovalAt` into `HeartbeatTaskState`, report `needs_user_action`, **return** (single-shot).
- **Out-of-band:** operator reviews and runs `ApprovalManager.decide({ approvalId, decision: 'approved', decidedBy })` (manager.ts; throws unless `pending`).
- **Tick N+1 (externally invoked):** read `pendingApprovalId` → look up status (`approved`) → Gate B true → row 8 → `execute`; on success stamp `lastRunAt`/`lastExecAt`/`lastApprovalId`, clear `pendingApprovalId`. `denied`/`expired` → clear and report `blocked`/`needs_user_action`.

This honours `RunResumeMetadata.autoExecuteApprovedActions: false` (session/types.ts): heartbeat **never** executes on the same tick it requests approval — execution always requires a *subsequent externally-invoked tick*, enforced by the persisted pending id + single-shot return.

### D8 — State schema v2 (field deltas, literal→boolean widening, migration)

`HEARTBEAT_SCHEMA_VERSION`: **`1` → `2`** (types.ts:1), pre-authorized by ADR-001:241. Package version unchanged (`0.1.0`, C10).

```ts
// src/heartbeat/types.ts — additive (no field removed/retyped)

interface HeartbeatTaskState {            // EXTENDED (was types.ts:28-32)
  lastDryRunAt?: string;                  // unchanged
  lastStatus?: HeartbeatTaskResultStatus; // unchanged
  lastRunAt?: string;                     // EXISTS — now actually WRITTEN on real execution
  pendingApprovalId?: string;             // NEW — set on row 6, cleared on consume
  pendingApprovalAt?: string;             // NEW
  lastApprovalId?: string;                // NEW — approval that authorized the last execution
  lastExecAt?: string;                    // NEW
  lastExecStatus?: 'executed' | 'refused' | 'needs_user_action'; // NEW
}

// literal → boolean widening (runner.ts:29)
interface HeartbeatTickReport {           // WIDENED
  dryRun: boolean;                        // was literal `true`
  safety: {
    llmInvoked: boolean;                  // was literal `false`
    toolsInvoked: boolean;                // was literal `false`
    autonomousActionsExecuted: boolean;   // was literal `false`
    schedulerInstalled: false;            // stays false (no daemon, C5)
    secretsIncluded: false;               // stays false (C6)
    contentPolicy: 'metadata-only-redacted'; // unchanged
    notes: string[];
  };
}

type HeartbeatTaskResultStatus =          // EXTENDED
  | 'due' | 'skipped' | 'blocked' | 'needs_user_action'
  | 'executed' | 'refused';               // NEW
type HeartbeatTickStatus =                // EXTENDED
  | 'dry_run_completed' | 'blocked'
  | 'executed' | 'refused';               // NEW
```

**Migration note:** v1 state files are **forward-readable** — `HeartbeatStore.readState` reconstructs field-by-field (ADR-001:241), so absent v2 fields default `undefined`; the v2 writer is purely additive. **No data-migration step.** The next state write stamps `schemaVersion: 2`. Existing `ticks/` and `plans/` artifacts stamped `1` remain valid history. Because, by default, the only reachable rows are 1–4 (`dry_run`), **no v2 field is ever populated under default flags** — the bump is inert until execution is enabled.

---

## 3. CLI / invocation surface (design)

| Command | V3 change | Writes | State mutation |
|---|---|---|---|
| `nova heartbeat tick [--dry-run] [--now <iso>]` | Unchanged when flags off (V2-identical). Under `A∧C` it may **create** a pending approval (row 6) or, under `A∧B∧C`, **execute** (row 8) via delegation. `--dry-run` forces `dry_run` regardless of flags. | `.nova/heartbeat/ticks/<tickId>.{json,md}` (+ pending-id in `state.json`) | additive task-state fields only |
| `nova heartbeat approvals` *(thin, read-only — Open Q4)* | List heartbeat `pendingApprovalId → approvalId` so the operator can `decide` out-of-band. Lists only; never executes. | none | none |

No new daemon, timer, or scheduler (C5). The operator's existing approval surface performs `decide`; execution happens on the next externally-invoked tick.

---

## 4. Explicit NON-GOALS (this iteration will NOT do any of these)

1. **No sandbox implementation.** `probeExecutionSandbox()` returns `null`; Gate C is fail-closed (C3). The isolation primitive is a *later* slice.
2. **No self-approval / no daemon / no self-loop.** Heartbeat never calls `decide()`; ticks stay single-shot and externally invoked (C5).
3. **No spawn under `src/heartbeat/**`.** Execution is delegated to `ToolRegistry`/`NovaAgent` (C4); the reworked guard enforces it.
4. **No lifting of DANGEROUS kinds.** `shell`/`write`/`git`/`network`/`memory-write`/`auto-resume` stay FORBIDDEN in V3 (§D6).
5. **No writes outside `.nova/heartbeat/`; no secrets/absolute paths; metadata-only redacted reports** (C6).
6. **No new runtime dependency** (C7). **No package version bump** (stays `0.1.0`, C10).
7. **No default-behaviour change.** Flag unset ⇒ byte-identical to V2.

---

## 5. Security & safety analysis — numbered invariants (each with an OFFLINE test)

| # | Invariant | Offline test |
|---|---|---|
| **SI-1** | **Default-off ⇒ zero behaviour change.** Flag unset ⇒ every `ok` task ⇒ `dry_run`; report byte-compatible with V2 (`dryRun:true`, all `safety.*` false). | Unit over fixtures with `flags.heartbeatExec=false`: assert `mode==='dry_run'` for all; snapshot-equal a V2 report. |
| **SI-2** | **Fail-closed sandbox (C3).** Flags on + approval `approved` + `sandbox.available=false` ⇒ `refused`, `decidedBy='gate-c-sandbox'` (rows 5, 7). | Unit: rows 5 & 7 ⇒ `mode==='refused'`. |
| **SI-3** | **No self-approval.** Heartbeat never calls `ApprovalManager.decide`. | Static guard: no `.decide(` in `src/heartbeat/**`; unit: runner path only *creates*/*reads*. |
| **SI-4** | **No spawn/timer in heartbeat (reworks ADR-001:226).** | Extended static guard over **all** `src/heartbeat/**`: no `child_process`/`exec`/`execFile`/`spawn`/`setInterval`/`setTimeout`/`setImmediate`/`while(true)`. |
| **SI-5** | **FORBIDDEN kinds never execute.** | Unit: each DANGEROUS kind ⇒ `classifyHeartbeatTaskSafety ∈ {blocked,needs_user_action}` and `decideHeartbeatExecution` never yields `execute`. |
| **SI-6** | **Sandbox env is an allow-list (never the full parent env).** | Type/structure test: `SandboxExecRequest.env` is an explicit map; executor builds env from allow-list, never `...process.env` (contrast bash.ts:116). |
| **SI-7** | **Writes only under `.nova/heartbeat/`.** | Unit: all new paths via `assertPathUnderDir`; guard asserts no other write root. |
| **SI-8** | **Metadata-only redacted reports.** | Unit: exec report routes through `safeHeartbeat*`; assert no `stdout`/`stderr` bodies persisted — only `exitCode`/`durationMs`/`truncated`. |
| **SI-9** | **Single-shot — no wait/loop.** | Static (SI-4 timers) + unit: tick returns after persisting pending id, never blocks for a decision. |
| **SI-10** | **Cross-tick approval integrity.** | Unit with fake clock + in-memory approval + injected `available` sandbox stub: execute only on tick N+1 after `approved`; `pendingApprovalId` cleared; `denied`/`expired` re-request. (No real tools.) |

**Blast radius:** under default flags, identical to V2 (a few KB of redacted dry-run metadata). Even fully enabled, execution is bounded to PERMITTED `ok` kinds, isolated by the sandbox, policy-gated to `readonly`+approval, and writes only under `.nova/heartbeat/`.

---

## 6. Schema-version impact & migration

- **`HEARTBEAT_SCHEMA_VERSION`: `1` → `2`** (types.ts:1) — the bump ADR-001:241 pre-authorized for exactly this case (persisting execution/approval state).
- **Forward-readable, no migration step:** `readState` reconstructs field-by-field ⇒ v1 files load with new fields `undefined`; v2 writer is additive.
- **Inert by default:** with default flags only `dry_run` is reachable ⇒ no v2 field is ever written ⇒ a default deployment never produces a v2 state file until execution is explicitly enabled.
- **Package version unchanged** (`0.1.0`, C10) — schema version is internal to the heartbeat module.

---

## 7. Alternatives considered

- **A1 — Spawn directly inside heartbeat *(REJECTED)*.** Trips ADR-001:226 and bypasses policy/approval/redaction. Delegation via `ToolRegistry`/`NovaAgent` inherits all three (D5).
- **A2 — A single boolean flag instead of a triple gate *(REJECTED)*.** No defense-in-depth; one misconfiguration ⇒ autonomy. The AND-composed triple gate makes any single failure fail-closed (C1).
- **A3 — Allow execution without a sandbox for "read-only" PERMITTED tasks *(DEFERRED)*.** Tempting for `inspection`/`eval`, but V3 mandates uniform fail-closed (C3). Revisit via Open Q2 with a proven read-only capability set.
- **A4 — Auto-approve heartbeat execution within the same tick *(REJECTED)*.** Violates no-self-approval and `autoExecuteApprovedActions:false`. The cross-tick handshake (D7) requires a human `decide` + a subsequent tick.
- **A5 — Lift DANGEROUS kinds into PERMITTED behind approval *(REJECTED for V3)*.** Out of scope; keeps blast radius minimal. A future per-kind ADR can promote them.
- **A6 — A long-running daemon that awaits the approval then executes *(REJECTED)*.** Violates the no-daemon rule (C5); the single-shot cross-tick model achieves the same outcome without a background process.
- **A7 — Bump the package to `0.2.0` *(REJECTED)*.** CTO pins `0.1.0` (C10); only the internal `HEARTBEAT_SCHEMA_VERSION` advances.

---

## 8. Open questions (with recommended defaults)

> **RESOLVED at acceptance (Orchestrator/CTO, 2026-06-23):** Q1 → **hardened subprocess** (containers deferred to a later ADR), scoped to S3. Q2 → **YES, uniform Gate-C fail-closed in V3**. Q3 → reuse existing approval expiry, else **24 h**, treat `expired` as `needs_user_action`, scoped to S2. Q4 → add thin read-only `nova heartbeat approvals`, scoped to S2 (NOT S1). Q5 → serialize via existing `store.withLock` with consume-once on `pendingApprovalId`, scoped to S2. **None of Q3/Q4/Q5 affect Slice 1.** The "latent capability" trade-off (§9) is **accepted as intended**: S1 adds zero reachable execution (fail-closed ∧ default-off ⇒ only `dry_run`/`refused`).

- **Q1 — Sandbox technology** (hardened subprocess + rlimits vs container vs micro-VM)? **Default:** start with a **hardened subprocess** (env allow-list + `cwd` jail via `src/policy/path.ts` + timeout/kill mirroring `bash.ts`) in Slice 3; defer containers to a later ADR.
- **Q2 — Require Gate C for provably read-only PERMITTED tasks?** **Default:** **YES** in V3 (uniform fail-closed). Relax only via a future ADR with a vetted read-only capability set.
- **Q3 — Approval expiry for heartbeat pending approvals?** **Default:** reuse the existing approval expiry; if none, **24 h**, and treat `expired` as `needs_user_action` (re-request on the next tick).
- **Q4 — Where does the operator call `decide`?** **Default:** reuse the existing approval CLI/manager; add a thin **read-only** `nova heartbeat approvals` mapping `pendingApprovalId → approvalId`. Execution remains on the next tick.
- **Q5 — Two ticks racing on the same pending approval?** **Default:** serialize via the existing `store.withLock`; consume-once semantics keyed on `pendingApprovalId`.

---

## 9. Consequences

### Positive
- **Fail-closed by construction:** absent sandbox ⇒ refuse; default flags ⇒ pure dry-run. Safety does not depend on a single switch.
- **Zero default-behaviour change** (SI-1); the schema bump is inert until execution is enabled.
- **Reuses** policy + approval + redaction via `ToolRegistry`/`NovaAgent` — no parallel security path to audit.
- **Sandbox interface is reusable** beyond heartbeat (notably `bashTool`), centralizing isolation and the env allow-list.
- **Incremental:** Slice 1 ships the entire safety skeleton **with no execution and no sandbox dependency**.

### Negative / trade-offs
- **Execution is unreachable until the sandbox slice** — intended, but means V3-as-shipped adds latent capability, not user-visible execution.
- **Schema bump to `2`** — mitigated: forward-readable, additive, inert by default.
- **More state fields to redact** — bounded; reuses the V1 redaction machinery (SI-8).
- **Two-tick latency** for an approved execution — a deliberate consequence of single-shot + no-self-approval (D7).

---

## 10. Safe-slice breakdown

> **Slice 1 is fully OFFLINE and has NO dependency on a working sandbox.** It ships the shared interface + a `null` probe (pure types, no spawn), the pure gate, the schema v2 migration, the report widening, the `lastRunAt` plumbing, and the reworked static guard. Net runtime effect: **flag off ⇒ V2-identical; flag on ⇒ `refused` (fail-closed).**

| Slice | Deliverable | Gate state at end | Key tests | Depends on |
|---|---|---|---|---|
| **S1 — Gate scaffolding (OFFLINE, no sandbox impl)** | `src/sandbox/types.ts` (interface) + `src/sandbox/probe.ts` (returns `null`); `src/heartbeat/execution_gate.ts` (pure `decideHeartbeatExecution`); schema `1→2` + `HeartbeatTaskState` deltas + `readState` forward-read; report literal→boolean widening; `lastRunAt` plumbing in `nextState` (written only on `execute` ⇒ inert today); reworked static guard over all `src/heartbeat/**`. | A wired (default off); B read-only (`'none'`); **C hard-false (probe `null`)**. Flag off ⇒ `dry_run`; flag on ⇒ `refused`. | Truth-table (8 rows); schema migration v1→v2; default-off parity (SI-1); fail-closed (SI-2); static guard (SI-4); FORBIDDEN-never-execute (SI-5). | — (interface+probe are pure; **no working sandbox needed**) |
| **S2 — Approval lifecycle across ticks (OFFLINE w/ fakes)** | `src/heartbeat/executor.ts` create/persist/consume of `pendingApprovalId` (rows 6→8 exercised via an **injected** `available` sandbox stub + in-memory approval; production C still `null`). | A wired; **B fully wired**; C hard-false in prod (fail-closed preserved). | Cross-tick integrity (SI-10); denied/expired; pending-id persist/clear; no-self-approval (SI-3); single-shot (SI-9). | **S1** |
| **S3 — ExecutionSandbox implementation (ROADMAP.md:125 blocker)** | Real `src/sandbox/**` (env allow-list, `cwd` jail, timeout/kill/truncation mirroring `bash.ts`); `probeExecutionSandbox()` returns a real sandbox on supported platforms; optional `bashTool`-through-sandbox refactor. **Not offline** — own integration smoke. | **C can be true** (platform-dependent); execution still requires A∧B. | Sandbox isolation smoke (env allow-list SI-6, timeout kill, truncation); bashTool parity. | **S1** (interface) — independent of S2 |
| **S4 — Real delegated execution behind the full triple gate** | Executor runs PERMITTED `ok` tasks via `registry.toAITools({ policy:{ profileId:'readonly', approvalProvided:true, hook:createApprovalPolicyHook(...) }})` inside the sandbox; stamps `lastRunAt`/`lastExecAt`/`lastExecStatus`; redacted metadata-only report. | **All gates live** (default still off). | Policy-composition unit (registry.ts:191 widening); redaction (SI-8); gated end-to-end smoke (opt-in env, excluded from default CI). | **S2 ∧ S3** |

#### Dependency edges

```
        src/sandbox/types.ts  (interface — shipped in S1)
                  │
        ┌─────────┴───────────┐
   ┌──────────┐          ┌──────────────────────┐
   │ Slice 1  │          │ Slice 3              │
   │ gate +   │          │ sandbox impl         │
   │ schema   │          │ (real ExecutionSandbox)│
   └────┬─────┘          └──────────┬───────────┘
        │                           │
        ▼                           │
   ┌──────────┐                     │
   │ Slice 2  │ approval lifecycle  │
   └────┬─────┘                     │
        └────────────┬─────────────-┘
                     ▼
              ┌──────────────┐
              │ Slice 4      │  delegated execution (A∧B∧C)
              └──────────────┘
```

`S1 → S2`, `S1 → S3`, `(S2 ∧ S3) → S4`. **S1 and S3 share only the interface; S1 needs no working sandbox.**

---

## 11. Per-slice implementer task templates

> Each template follows the ADR-001 breakdown convention (mission / constraints / deliverables / report-back). Validation = repo npm scripts (`typecheck`, `build`, `cli:smoke`, `heartbeat:smoke`), not pytest (ADR-001 C8).

### Task — Slice 1 (Gate scaffolding, OFFLINE, no sandbox impl)
- **Mission:** Add the fail-closed triple-gate decision layer + schema v2 + report widening, with **zero default-behaviour change** and **no sandbox dependency**.
- **Constraints:** Pure `decideHeartbeatExecution` (no I/O/timers/spawn). `probeExecutionSandbox()` returns `null`. `HEARTBEAT_SCHEMA_VERSION=2`, additive + forward-readable. Reworked static guard over all `src/heartbeat/**`. No new dependency; package stays `0.1.0`. No real shell/LLM/network.
- **Deliverables:** `src/sandbox/{types.ts,probe.ts}`; `src/heartbeat/execution_gate.ts`; `types.ts` schema/state/report deltas; `runner.ts:22` gate call + `:29` widening + `nextState` `lastRunAt` plumbing; extended guard test.
- **Report back:** files changed; truth-table + migration + parity + guard test results (exit codes); confirmation that flag-off output is byte-identical to V2 and flag-on yields `refused`.

### Task — Slice 2 (Approval lifecycle across ticks, OFFLINE w/ fakes)
- **Mission:** Implement create/persist/consume of `pendingApprovalId` across single-shot ticks; **Nova never calls `decide`**.
- **Constraints:** Production Gate C stays `null` (fail-closed). Transitions proven via an injected `available` sandbox stub + in-memory approval. Honour `autoExecuteApprovedActions:false` (no same-tick execution).
- **Deliverables:** `src/heartbeat/executor.ts` (lifecycle only, no real tools); state persistence/clear; `nova heartbeat approvals` read-only listing (Open Q4).
- **Report back:** cross-tick test (tick N create → `decide(approved)` → tick N+1 consume); denied/expired paths; proof `decide` is never called from `src/heartbeat/**`.

### Task — Slice 3 (ExecutionSandbox implementation — ROADMAP.md:125)
- **Mission:** Implement a real `ExecutionSandbox` (hardened subprocess, Open Q1) and flip `probeExecutionSandbox()` to return it on supported platforms.
- **Constraints:** Lives under `src/sandbox/**` (outside heartbeat). Env **allow-list only** (never `...process.env`, contrast bash.ts:116). `cwd` jailed via `src/policy/path.ts`. Timeout/kill/truncation mirror `bash.ts`. Reusable by `bashTool`.
- **Deliverables:** `src/sandbox/**` implementation; integration smoke; optional `bashTool`-through-sandbox refactor + parity test.
- **Report back:** isolation evidence (env allow-list, timeout kill, truncation); platform support matrix; bashTool parity result.

### Task — Slice 4 (Real delegated execution behind the full triple gate)
- **Mission:** Execute PERMITTED `ok` tasks via `ToolRegistry`/`NovaAgent` inside the sandbox, only when A∧B∧C.
- **Constraints:** No spawn in heartbeat (guard holds). Delegate with `profileId:'readonly'` + `approvalProvided:true` + `createApprovalPolicyHook`. Metadata-only redacted reports. Default flags still off.
- **Deliverables:** executor execute-path; state stamping (`lastRunAt`/`lastExecAt`/`lastExecStatus`/`lastApprovalId`); redaction; gated opt-in end-to-end smoke (excluded from default CI).
- **Report back:** policy-composition unit (registry.ts:191); redaction proof (SI-8); gated smoke output behind explicit env.

---

## 12. Validation gates (per ADR-001 C8)

```
npm run typecheck
npm run build
npm run cli:smoke
npm run heartbeat:smoke      # extended: gate truth-table + schema v1→v2 migration
                             #           + reworked static guard + default-off parity
```

**Deterministic acceptance (Slice 1):**
1. With **all flags unset**, a fixed-config tick over `ok` tasks emits a report **byte-identical to V2** (`dryRun:true`, every `safety.*` flag false, status `dry_run_completed`).
2. With `NOVA_ENABLE_HEARTBEAT_EXEC=1` (and required capability flags) but `probeExecutionSandbox()===null`, every `ok` task yields `decideHeartbeatExecution → mode='refused'`, `decidedBy='gate-c-sandbox'` (truth-table rows 5/7).
3. The reworked static guard passes over **all** `src/heartbeat/**` (no spawn/timer/`decide`).

---

## 13. Slice 2 implementation addendum — approval lifecycle across ticks (2026-06-23)

> **Status:** Slice 2 implemented and verified **OFFLINE**. Realizes §D7 (cross-tick handshake), Open-Q3 (24 h expiry ⇒ `needs_user_action`), and Open-Q4 (read-only `nova heartbeat approvals`). Production **Gate C stays `null` ⇒ fail-closed is preserved**: no real execution ships. No change to the §D1 truth table, the §D8 schema, or any default behaviour; package stays `0.1.0` with zero new dependencies.

### 13.1 Approval gateway port (Gate B seam) — `src/heartbeat/executor.ts`

An injectable port makes the resolve step offline-testable while keeping Nova out of the decision:

```ts
export type HeartbeatApprovalResolution = Exclude<HeartbeatApprovalStatus, 'none'>; // 'pending'|'approved'|'denied'|'expired'
export interface HeartbeatApprovalGateway { resolve(approvalId: string): Promise<HeartbeatApprovalResolution>; }
export function createReadOnlyApprovalGateway(): HeartbeatApprovalGateway; // production stub: always 'pending', zero I/O
```

The production gateway is a **read-only stub** — `resolve()` returns `'pending'` and performs no I/O, no spawn, no timer — because the session/approval-manager bridge is **deferred to Slice 4**. It therefore passes the reworked §D5 guard, which now also sweeps `executor.ts`. **Heartbeat never calls `ApprovalManager.decide`**, asserted by an explicit `assert.doesNotMatch(executorSource, /\.decide\(/)` (SI-3).

### 13.2 Pure lifecycle (mint → resolve → patch)

- `mintHeartbeatApprovalId()` → `hb-appr-<randomUUID()>` (synthetic; never collides with session `appr_*` ids; short enough to survive report redaction intact).
- `HEARTBEAT_APPROVAL_TTL_MS = 24 h`; `isHeartbeatApprovalExpired(pendingAt, now)` realizes Open-Q3.
- `evaluateHeartbeatExecution(...)` resolves the persisted `pendingApprovalId` into a Gate-B `approval.status` with a **short-circuiting precedence**, each step skipping the next:
  1. **no `pendingApprovalId`** ⇒ `'none'` (gateway **not** consulted) ⇒ mint a fresh approval, persist `pendingApprovalId` + `pendingApprovalAt`, report `needs_user_action`.
  2. **pending and expired** ⇒ `'expired'` (gateway **not** consulted) ⇒ reset pending, report `needs_user_action` (re-request next tick).
  3. **otherwise** ⇒ `gateway.resolve(pendingApprovalId)` ⇒ `approved` (→ §D1 row 8 candidate `execute`, still C-gated) / `denied` (→ `blocked`, request discarded) / `pending` (→ keep awaiting).
- `applyHeartbeatApprovalPatch(...)` is the single pure state-transition writer (kinds: `executed` / `mint` / `await` / `reset` / `blocked` / `refused` / `none`), threading the injected `now` into every timestamp and clearing/retaining `pendingApprovalId` per kind.

### 13.3 Runner wiring — `src/heartbeat/runner.ts`

`runHeartbeatDryRunTick` gains injectable seams `flags? / sandboxAvailable? / approvalGateway? / now?`, each defaulting to its production value (`readHeartbeatExecutionFlags()`, the `null` probe, `createReadOnlyApprovalGateway()`, real wall clock). The Slice-1 hard-coded `approval: { status: 'none' }` is replaced by the resolved `{ status, approvalId }`. A `needs_user_action` task keeps the tick at `dry_run_completed` (single-shot, no daemon); execution can only occur on a **subsequent** externally-invoked tick, honouring `autoExecuteApprovedActions:false`.

### 13.4 Read-only CLI (Open-Q4)

`nova heartbeat approvals` (registered in `src/cli/index.ts`, documented in `src/cli/help.ts`) lists, per task, `pendingApprovalId` / `pendingApprovalAt` / `lastApprovalId` / `lastExecStatus` from `state.json`. It **reads only** — no `decide`, no state mutation (asserted byte-identical before/after) — surfacing the ids so the operator can `decide` out-of-band.

### 13.5 Offline proof (added to `src/heartbeat/smoke.ts`)

Five deterministic scenarios on a fixed `now` clock with a **tracking gateway** stub (records every id it is asked to resolve): (SI-10/SI-9) approve ⇒ execute one tick later ⇒ the next due tick mints a **fresh** id (the grant is single-shot); denied ⇒ `blocked`, pending discarded; pending +25 h ⇒ `expired` ⇒ `needs_user_action` with the gateway **never consulted** (expiry short-circuits Gate B); (SI-1) master flag off ⇒ task stays `due`, gateway never consulted, no execution bookkeeping written (V2 parity even with a gateway injected); the read-only CLI lists a seeded approval and leaves `state.json` byte-identical. `npm run check` exits 0 fully offline.

---

## 14. Slice 3 implementation addendum - real hardened execution sandbox (capability-only, opt-in) (2026-06-24)

> **Status:** Slice 3 implemented and verified **OFFLINE**. Realizes D4 (the execution-sandbox boundary, Gate C) as a real subprocess capability, plus the two Slice-3 security blockers **SB1** (strict opt-in) and **SB2** (env hardening). The sandbox is a **capability only**: `ExecutionSandbox.run()` has **zero callers in `src/heartbeat/**`**, so the heartbeat still fails closed by default and no real heartbeat execution ships. No change to the D1 truth table, the D8 schema, the Slice-2 approval lifecycle, or any default behaviour; package stays `0.1.0` with zero new dependencies (node builtins only).

### 14.1 Scope and the capability-only invariant

Slice 3 builds the missing Gate-C dependency - a sandbox that can actually run a command - but deliberately does **not** wire it into the tick. The Slice-1/Slice-2 contract that production Gate C resolves to a closed gate is preserved by keeping the probe `null` unless an operator explicitly opts in (SB1 below). The wiring of `run()` into the executor execute branch is **deferred to Slice 4**.

- `ExecutionSandbox.run()` (the method name shipped as `run`, where design note D4 had sketched `exec`) has **no caller** anywhere under `src/heartbeat/**`; `runner.ts` consumes only `probeExecutionSandbox()?.available`. This is asserted by audit grep (zero `\.run\(` callers in the heartbeat tree) and is the load-bearing reason the heartbeat behaviour is byte-identical to Slice 2.
- All spawn/timer primitives live under `src/sandbox/**` (`sandbox.ts`, `smoke.ts`). **None** are added to `src/heartbeat/*.ts`, so the directory-wide D5 static guard (still sweeping its 13 heartbeat modules, non-recursively, excluding its own `smoke.ts`) keeps passing untouched.

### 14.2 The sandbox - `src/sandbox/sandbox.ts`

`createExecutionSandbox()` returns an `ExecutionSandbox { id; available: true; run(req) }`. Constructing it spawns nothing, starts no timer, performs no I/O; the first child process exists only on `run()`.

- **Shell-free spawn.** Commands are spawned with `shell: false`, so shell metacharacters (`|`, `$`, `;`, `&`, backticks) are passed as literal `argv` and never interpreted. `validateCommand` throws on an empty command, a NUL byte, or an oversized argv.
- **cwd jail.** The requested working directory is resolved and asserted under `PROJECT_ROOT` (reusing `assertPathUnderDir` / `deniedPathReason` from `safe_io`); anything outside (e.g. `os.tmpdir()`) is rejected before any spawn.
- **Deterministic limits.** A wall-clock timeout and a combined stdout/stderr character budget are clamped to sane floors/ceilings (`clampNumber`; defaults 30 000 ms / 20 000 chars, hard caps 300 000 ms / 200 000 chars). On timeout **or** truncation the result forces `exitCode: null` (a Windows `taskkill /F` would otherwise surface a misleading `1`), with `timedOut` / `truncated` flags set.
- **Process-tree teardown.** Kill uses `taskkill /T /F` on Windows and a detached process-group signal (`SIGTERM` then `SIGKILL` after a kill-grace) on POSIX, so children of the spawned process do not leak.
- **Error redaction.** `sanitizeSpawnError` maps spawn failures to stable reasons without leaking absolute paths or the inherited environment.

### 14.3 SB1 - strict opt-in probe - `src/sandbox/probe.ts`

The Slice-1 always-`null` stub is replaced by `probeExecutionSandbox(env = process.env)`:

```ts
export function probeExecutionSandbox(env: NodeJS.ProcessEnv = process.env): ExecutionSandbox | null {
  if (!isHeartbeatFlagEnabled(env.NOVA_ENABLE_EXEC_SANDBOX)) return null; // strict: only '1' | 'true'
  if (!sandboxIsSupportedPlatform()) return null;                          // win32 | linux | darwin
  return createExecutionSandbox();
}
```

- It reuses `isHeartbeatFlagEnabled` (`FLAG_TRUE = {'1','true'}`), so `unset` / `"0"` / `"TRUE"` / `" 1 "` all resolve to **disabled** -> `null` -> Gate C closed -> fail-closed. Only an exact `"1"` or `"true"` on a supported platform yields a live sandbox.
- The new platform gate lives in `src/sandbox/platform.ts` (`sandboxIsSupportedPlatform()`), keeping unsupported platforms closed.
- The optional `env` parameter is what makes Slice 3 a zero-call-site-change drop-in: the existing `runner.ts` call `probeExecutionSandbox()?.available` still type-checks and behaves identically (default `process.env`). Note the heartbeat smoke's SI-2, which sets `NOVA_ENABLE_HEARTBEAT_EXEC=1` but **not** `NOVA_ENABLE_EXEC_SANDBOX`, therefore still observes a refused/fail-closed tick - exactly as before.

### 14.4 SB2 - environment hardening - `buildChildEnv`

The child environment is assembled on a **null-prototype** object (`Object.create(null)`) from a per-platform **allow-list** of base loader-resolution vars only - never `...process.env`:

- **Base allow-list (`BASE_ENV_ALLOWLIST`, copied from the parent for these names only):** POSIX `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`; Windows `PATH`, `SystemRoot`, `COMSPEC`, `PATHEXT`, `TEMP`, `TMP`. Every other parent var (secrets, API keys, tokens) is excluded by construction.
- **Caller env may add but never override the protected subset.** Caller-supplied keys are merged on top, but the loader-resolution vars `PATH` (and on Windows `SystemRoot` / `COMSPEC` / `PATHEXT`, compared case-insensitively) are **not** overridable by the caller - the base value wins.
- **Loader-injection deny-list dropped unconditionally:** `LD_PRELOAD`, `LD_LIBRARY_PATH`, `NODE_OPTIONS`, and any `DYLD_*` var.
- **Sanitisation:** invalid names, non-string values, oversized values, and NUL-bearing entries are dropped (continue, not throw). The null prototype means a literal `__proto__` key (e.g. from `JSON.parse('{"__proto__":...}')`) lands as an own property and cannot pollute the prototype chain - `Object.getPrototypeOf(childEnv) === null` is asserted.

### 14.5 Offline proof (`src/sandbox/smoke.ts`) and gate wiring

An **isolated** smoke (separate from `heartbeat/smoke.ts`) runs 9 deterministic, fully-offline tests: (1) end-to-end env allow-list - a real spawn cannot observe a scrubbed `NOVA_SECRET_SENTINEL`; (2) pure `buildChildEnv` loader-deny + `__proto__` non-pollution; (3) pure `PATH` non-override + bad-name drop; (4) a 250 ms timeout forces `exitCode: null`; (5) a 16-char output budget truncates to len 16 with `exitCode: null`; (6) cwd jail accepts a `mkdtemp` dir under `PROJECT_ROOT` and rejects `os.tmpdir()`; (7) shell-free literal arg passing (`alpha|be ta|$NOVA`); (8) `clampNumber` floors/ceilings; (9) the SB1 opt-in matrix (`unset`/`"0"`/`"TRUE"`/`" 1 "` -> `null`; `"1"`/`"true"` -> available). It prints `sandbox:smoke passed` and restores `process.env` afterward. `sandbox:smoke` is wired into both `check` and `check:fast` (after `heartbeat:smoke`); `npm run check` exits 0 fully offline.

## 15. Slice 4 implementation addendum - real delegated execution wired behind the triple-gate (fail-closed, opt-in) (2026-06-24)

> **Status:** Slice 4 implemented and verified **OFFLINE**. Wires the executor `execute` branch (formerly an `executed`-fabricating stub) to a **real delegated run** via an injected capability that composes `ToolRegistry.toAITools` + the Slice-3 `ExecutionSandbox.run`. Real execution is **off by default and gated on A∧B∧C**; with the master flag off the tick is **byte-identical to V2** (whole-report parity snapshot), and **production Gate B still resolves to `'pending'`**, so row 8 is physically unreachable in production (double fail-closed). Scope is **mechanism-only**: the `hb-appr-<uuid>` ↔ `approval_<N>` session bridge is **deferred to Slice 4b**. No change to the D1 truth table, the D8 schema, or any default behaviour; package stays `0.1.0` with zero new dependencies; `src/sandbox/**` is untouched.

### 15.1 The execution port and the row-8 handler

The stub at `executor.ts:135-142` previously returned `status: 'executed'` on row 8 **without running anything** - a latent danger now removed. Slice 4 adds an injectable port and a dedicated handler:

- **`HeartbeatExecutionCapability { run(req: HeartbeatExecRequest): Promise<HeartbeatExecOutcome> }`** - the heartbeat owns **no** runner; it only invokes `.run` on this seam. `HeartbeatExecRequest` is the secret-free `{ taskId, kind }`; `HeartbeatExecOutcome` is metadata-only `{ ok, summary, exitCode?, durationMs? }`.
- **`capability?` is threaded** through `runHeartbeatDryRunTick` (`runner.ts`) into `HeartbeatEvaluationInput`. Absent at row 8 ⇒ fail-closed refuse.
- **`resolveDelegatedExecution`** replaces the stub return and maps the outcome to a result + approval patch under the §D9 rules below.

### 15.2 §D9 trust boundary - the four row-8 branches

| Condition | Result status | Approval patch | Grant |
|-----------|---------------|----------------|-------|
| capability absent | `refused` | `{kind:'refused'}` | **retained** (transient; R1 - never fabricate `executed`) |
| `capability.run` throws/rejects | `refused` | `{kind:'blocked'}` | **consumed** (R3 - caught at the boundary) |
| `outcome.ok === false` | `refused` | `{kind:'blocked'}` | **consumed** |
| `outcome.ok === true` | `executed` | `{kind:'executed', approvalId, at}` | **consumed** |

- **R3 (load-bearing):** the `await capability.run(...)` is wrapped in `try/catch`; a thrown/rejected error **never** propagates out of `evaluateHeartbeatExecution`. If it did, the `Promise.all` in `runner.ts:40` would reject, the tick state would never persist (crash/retry loop) and SI-9 would break. The catch maps to `refused` + grant consumed.
- **R1:** a missing capability maps to `refused` with the grant **retained** so a later tick (once wiring exists) can still execute - the heartbeat never invents an `executed` outcome.

### 15.3 BLOCKER-2 - redaction allow-by-default (SI-8)

`redaction.ts:35,46` spread `...task` / `...report`, i.e. redaction is **allow-by-default**: any *new* persisted field would survive unredacted. Slice 4 therefore adds **no** free-text field to `HeartbeatTaskResult` / `HeartbeatTickReport` / `HeartbeatTaskState`. The outcome `summary` is surfaced **only** through `result.reason`, which `redaction.ts:41` already routes through `safeHeartbeatText` (truncate 500 + `containsSecretLike`). The smoke proves this with a **full-blob** assertion - `assert.doesNotMatch(JSON.stringify(tick), /<secret>/)` - not a field-level check.

### 15.4 Production wiring outside the swept tree - `src/autoexec/**`

To keep the heartbeat static guard pristine, the real capability lives in a **new directory** that the guard does not sweep:

- **`src/autoexec/capability.ts`** (`createDelegatedExecutionCapability`) composes the ADR-mandated routes - `ToolRegistry.toAITools({ policy: { profileId:'readonly', approvalProvided:true, hook } })` (exercising the `registry.ts:191` `ask -> allow` widening) and/or `ExecutionSandbox.run` for subprocess tasks. It imports the sandbox **types only** (the real instance is injected).
- **CAVEAT-5 (producer-side redaction):** when mapping `SandboxExecResult` (which carries `stdout`/`stderr`) to `HeartbeatExecOutcome`, the bodies are **dropped**; `summary` is metadata-only (e.g. `exit=<code> dur=<ms>ms`) and never raw output, env, or secrets.
- **Guard hardening (CAVEAT-1):** the directory sweep in `heartbeat/smoke.ts` now adds an **import-denylist** - no `src/heartbeat/*` module may import the `tools`/`session` runtime or reach `sandbox/` except the read-only `probe.js` - on top of the existing forbidden-token regex.

### 15.5 Offline proof and opt-in live proof

- **In `check` (offline):** `heartbeat:smoke` gains the whole-report byte-identical parity snapshot under master-off (across task kinds, CAVEAT-3), capability-absent⇒refused (grant retained), throw⇒refused (secret absent from the serialized tick), `ok:false`⇒refused, success⇒executed (summary secret redacted from the full tick, approval id audited), and the `registry.toAITools` policy-composition unit. A new `autoexec:smoke` offline unit asserts the producer never emits stdout/stderr bodies.
- **Out of `check` (opt-in):** `autoexec:live-smoke` (`--live`) builds a real `ExecutionSandbox` + `ToolRegistry`, injects an approving gateway + the real capability with the flags on, runs a tick under a temp `.nova/` root cleaned in `finally`, and asserts a **real** `node --version` execution (`status:'executed'`, an executed non-dry-run tick), with no write outside `.nova/`.
- `npm run check` exits 0 fully offline; the live path runs only when explicitly opted in.

### 15.6 Deferred to Slice 4b

The `hb-appr-<uuid>` (heartbeat ledger) ↔ `approval_<N>` (session manager) **namespace bridge** is **not** built in Slice 4. Production Gate B therefore stays `'pending'` and row 8 remains unreachable in production; lighting it up - plus the security re-audit of the bridged path (CAVEAT-6) - is Slice 4b.
