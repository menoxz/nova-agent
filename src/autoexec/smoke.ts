/**
 * Smoke suite for the delegated execution seam (ADR-002 Heartbeat V3, Slice 4).
 *
 * Three layers, gated so the default `check` pipeline never spawns a real process:
 *
 *  1. OFFLINE producer unit — ALWAYS runs. It drives
 *     {@link createDelegatedExecutionCapability} with FAKE {@link ExecutionSandbox}
 *     instances whose results carry sentinel stdout/stderr bodies, then proves
 *     CAVEAT-5: the `SandboxExecResult` → `HeartbeatExecOutcome` mapping keeps
 *     metadata only (exit code + duration) and DROPS the output bodies, the ok
 *     mapping is `exitCode === 0 && !timedOut && !truncated`, and a sandbox throw
 *     is caught at the seam and reported as a metadata-only `{ ok: false }`.
 *
 *  2. OFFLINE bridge unit — ALWAYS runs. It drives the REAL heartbeat↔session
 *     bridge {@link createHeartbeatApprovalBridge} over throwaway project roots
 *     (no subprocess: the bridge's capability seam is never invoked). It proves
 *     §SEC-C3 (the bridge LISTS/reads approvals but never decides one), the
 *     mint → pending → operator-verdict → resolve round-trip over a shared store,
 *     §SEC-B2 (the synthetic `approval_1` id resolves only under its FULL
 *     (sessionId, runId, approvalId) composite, never cross-run), and §SEC-C5
 *     (the locator is ids-only and a decision reason never crosses back).
 *
 *  3. LIVE end-to-end — OPT-IN via `--live` or `NOVA_HEARTBEAT_EXEC_LIVE_SMOKE`
 *     in {1,true}. It wires the REAL hardened {@link createExecutionSandbox} into
 *     the heartbeat and runs a granted `inspection` task (mint → resolve →
 *     execute), spawning `node --version` once. It asserts the tick executes and
 *     that the subprocess output never leaks into the redacted tick. Without the
 *     opt-in it prints `autoexec:live-smoke skipped (opt-in)` and exits 0.
 *
 * This file is the only `src/autoexec/**` test. It is a CALLER of the frozen
 * Slice-3 sandbox; it never modifies `src/sandbox/**`.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import { createDelegatedExecutionCapability } from './capability.js';
import { createHeartbeatDecisionApplier, mapHeartbeatDecisionError } from './decision_applier.js';
import { createHeartbeatApprovalBridge, type HeartbeatApprovalBridge } from './approval_gateway.js';
import { ApprovalManager } from '../approval/manager.js';
import { SessionRunManager } from '../session/manager.js';
import { createExecutionSandbox } from '../sandbox/sandbox.js';
import type { ExecutionSandbox, SandboxExecResult } from '../sandbox/types.js';
import { runHeartbeatDryRunTick } from '../heartbeat/runner.js';
import { HeartbeatStore } from '../heartbeat/store.js';
import { ToolRegistry } from '../tools/registry.js';
import type { HeartbeatApprovalGateway } from '../heartbeat/executor.js';
import type { HeartbeatExecutionFlags } from '../heartbeat/execution_gate.js';
import type { HeartbeatConfig, HeartbeatState, HeartbeatTaskState } from '../heartbeat/types.js';
import type { NovaTool } from '../types.js';

/** A fake sandbox returning a fixed result — never spawns a process. */
function fakeSandbox(result: SandboxExecResult): ExecutionSandbox {
  return { id: 'autoexec/fake-sandbox', available: true, async run() { return result; } };
}

/** A fake sandbox whose `run` rejects — exercises the capability's own catch. */
function throwingSandbox(message: string): ExecutionSandbox {
  return { id: 'autoexec/throwing-sandbox', available: true, async run() { throw new Error(message); } };
}

/** OFFLINE: prove CAVEAT-5 redaction and the ok/exit mapping with no real process. */
async function runOfflineProducerUnit(): Promise<void> {
  const STDOUT_SENTINEL = 'STDOUT_LEAK_3f8a2c';
  const STDERR_SENTINEL = 'STDERR_LEAK_9b1d4e';

  // A clean exit with populated output bodies: the outcome is ok, the summary is
  // metadata-only, and neither output body survives the mapping (CAVEAT-5).
  {
    const sandbox = fakeSandbox({ stdout: STDOUT_SENTINEL, stderr: STDERR_SENTINEL, exitCode: 0, timedOut: false, truncated: false, durationMs: 7 });
    const outcome = await createDelegatedExecutionCapability({ sandbox }).run({ taskId: 'offline-ok', kind: 'inspection' });
    assert.equal(outcome.ok, true, 'a clean exit maps to ok:true');
    assert.equal(outcome.exitCode, 0, 'the exit code is preserved');
    assert.equal(outcome.durationMs, 7, 'the duration is preserved');
    assert.match(outcome.summary, /^task=inspection exit=0 dur=7ms$/, 'the summary is metadata-only');
    const serialized = JSON.stringify(outcome);
    assert.doesNotMatch(serialized, new RegExp(STDOUT_SENTINEL), 'CAVEAT-5: the stdout body never reaches the outcome');
    assert.doesNotMatch(serialized, new RegExp(STDERR_SENTINEL), 'CAVEAT-5: the stderr body never reaches the outcome');
  }

  // A non-zero exit maps to ok:false while still dropping the output body.
  {
    const sandbox = fakeSandbox({ stdout: STDOUT_SENTINEL, stderr: '', exitCode: 1, timedOut: false, truncated: false, durationMs: 3 });
    const outcome = await createDelegatedExecutionCapability({ sandbox }).run({ taskId: 'offline-fail', kind: 'eval' });
    assert.equal(outcome.ok, false, 'a non-zero exit maps to ok:false');
    assert.equal(outcome.exitCode, 1, 'the non-zero exit code is preserved');
    assert.doesNotMatch(JSON.stringify(outcome), new RegExp(STDOUT_SENTINEL), 'CAVEAT-5: a failed run still drops stdout');
  }

  // A timeout maps to ok:false (exit code forced null) and the summary flags it.
  {
    const sandbox = fakeSandbox({ stdout: STDOUT_SENTINEL, stderr: STDERR_SENTINEL, exitCode: null, timedOut: true, truncated: false, durationMs: 30_000 });
    const outcome = await createDelegatedExecutionCapability({ sandbox }).run({ taskId: 'offline-timeout', kind: 'maintenance' });
    assert.equal(outcome.ok, false, 'a timed-out run is not ok');
    assert.match(outcome.summary, /timedOut/, 'the summary flags the timeout');
    assert.doesNotMatch(JSON.stringify(outcome), new RegExp(STDERR_SENTINEL), 'CAVEAT-5: a timed-out run still drops stderr');
  }

  // A truncated run maps to ok:false and the summary flags it.
  {
    const sandbox = fakeSandbox({ stdout: STDOUT_SENTINEL, stderr: '', exitCode: null, timedOut: false, truncated: true, durationMs: 12 });
    const outcome = await createDelegatedExecutionCapability({ sandbox }).run({ taskId: 'offline-trunc', kind: 'batch-dry-run' });
    assert.equal(outcome.ok, false, 'a truncated run is not ok');
    assert.match(outcome.summary, /truncated/, 'the summary flags the truncation');
  }

  // A sandbox that throws is caught at the seam and reported as a metadata-only
  // failure — the thrown message (carrying a secret) never reaches the outcome.
  {
    const SECRET = 'sk-autoexecThrow-1234567890';
    const sandbox = throwingSandbox(`spawn exploded ${SECRET}`);
    const outcome = await createDelegatedExecutionCapability({ sandbox }).run({ taskId: 'offline-throw', kind: 'inspection' });
    assert.equal(outcome.ok, false, 'a sandbox throw maps to ok:false');
    assert.match(outcome.summary, /run failed before completion/, 'the summary is a fixed metadata-only failure');
    assert.doesNotMatch(JSON.stringify(outcome), new RegExp(SECRET), 'a thrown error message never reaches the outcome');
  }

  console.log('autoexec:smoke offline unit passed');
}

/** Run `fn` against a fresh bridge over an isolated, throwaway project root. */
async function withBridge(
  fn: (ctx: { bridge: HeartbeatApprovalBridge; operator: ApprovalManager }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'nova-autoexec-bridge-'));
  try {
    await fn({
      bridge: createHeartbeatApprovalBridge({ projectRoot: root }),
      operator: new ApprovalManager({ projectRoot: root }),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * OFFLINE: prove the REAL heartbeat↔session bridge ({@link createHeartbeatApprovalBridge})
 * resolves an operator's verdict fail-closed, with no spawn. The bridge's capability owns
 * the only subprocess seam and is never invoked here; the requester and gateway perform
 * pure .nova/sessions/ I/O against an isolated throwaway store per sub-case.
 */
async function runOfflineBridgeUnit(): Promise<void> {
  // §SEC-C3 source guard — the bridge is read-only on the verdict axis: it LISTS
  // and reads approvals but NEVER decides one (neither ApprovalManager.decide nor
  // SessionRunManager.decideApproval), so the heartbeat can never grant itself.
  // Mirrors the executor's SI-3 guard, extended to the session bridge that lives
  // outside src/heartbeat/** and is therefore not swept by the heartbeat guard.
  const bridgeSource = await readFile(resolve(process.cwd(), 'src/autoexec/approval_gateway.ts'), 'utf-8');
  assert.doesNotMatch(bridgeSource, /\.decide(?:Approval)?\(/, 'C3: the session bridge never decides an approval');

  // Happy path — a freshly minted approval is pending until an operator decides it;
  // the gateway then reads the verdict back over the shared store. The minted locator
  // carries ONLY the three session ids (C5: no objective/reason/prompt body).
  await withBridge(async ({ bridge, operator }) => {
    const link = await bridge.requester.request({ taskId: 'inspect-docs', kind: 'inspection', capability: 'shell' });
    assert.ok(link, 'the requester mints a session approval locator');
    assert.deepEqual(Object.keys(link).sort(), ['sessionApprovalId', 'sessionId', 'sessionRunId'], 'C5: the locator is ids-only');
    assert.equal(await bridge.gateway.resolve(link.sessionApprovalId, link), 'pending', 'an undecided approval resolves pending (fail-closed)');
    await operator.decide({ approvalId: link.sessionApprovalId, decision: 'approved' });
    assert.equal(await bridge.gateway.resolve(link.sessionApprovalId, link), 'approved', 'the operator verdict reads back as approved');
  });

  // §SEC-B2 cross-run isolation — two independent requests both mint the synthetic
  // id `approval_1`; only the FULL (sessionId, runId, approvalId) composite tells
  // them apart. The operator decides the bare id (hitting one run, read from the
  // return value); the SAME `approval_1` on the OTHER run must stay pending, proving
  // a bare id can never grant across runs.
  await withBridge(async ({ bridge, operator }) => {
    const linkA = await bridge.requester.request({ taskId: 'task-a', kind: 'inspection', capability: 'shell' });
    const linkB = await bridge.requester.request({ taskId: 'task-b', kind: 'eval', capability: 'shell' });
    assert.ok(linkA, 'the first request mints a locator');
    assert.ok(linkB, 'the second request mints a locator');
    assert.equal(linkA.sessionApprovalId, 'approval_1', 'the first run mints approval_1');
    assert.equal(linkB.sessionApprovalId, 'approval_1', 'the second run independently also mints approval_1');
    assert.notEqual(linkA.sessionRunId, linkB.sessionRunId, 'the two runs are distinct');
    const decided = await operator.decide({ approvalId: 'approval_1', decision: 'approved' });
    const approved = decided.runId === linkA.sessionRunId ? linkA : linkB;
    const other = decided.runId === linkA.sessionRunId ? linkB : linkA;
    assert.equal(await bridge.gateway.resolve('approval_1', approved), 'approved', 'the composite matching the decided run resolves approved');
    assert.equal(await bridge.gateway.resolve('approval_1', other), 'pending', 'B2: the same approval_1 on the OTHER run never grants');
  });

  // Denied verdicts map through, and the decision reason — which may carry sensitive
  // text — never crosses back: the gateway returns ONLY the resolution token (C5).
  // An absent locator and a mismatched (wrong-run) locator both stay pending.
  await withBridge(async ({ bridge, operator }) => {
    const REASON_SECRET = 'sk-bridgeReason-7c1f2e';
    const link = await bridge.requester.request({ taskId: 'task-deny', kind: 'inspection', capability: 'shell' });
    assert.ok(link, 'the requester mints a locator to deny');
    await operator.decide({ approvalId: link.sessionApprovalId, decision: 'denied', reason: `operator denied ${REASON_SECRET}` });
    const verdict = await bridge.gateway.resolve(link.sessionApprovalId, link);
    assert.equal(verdict, 'denied', 'a denied approval resolves denied');
    assert.doesNotMatch(String(verdict), new RegExp(REASON_SECRET), 'C5: the decision reason never crosses the resolution boundary');
    assert.equal(await bridge.gateway.resolve(link.sessionApprovalId), 'pending', 'an absent locator resolves pending');
    assert.equal(
      await bridge.gateway.resolve(link.sessionApprovalId, { sessionApprovalId: link.sessionApprovalId, sessionRunId: 'run_does_not_exist', sessionId: link.sessionId }),
      'pending',
      'a mismatched (wrong-run) locator resolves pending',
    );
  });

  console.log('autoexec:smoke offline bridge unit passed');
}

/** OFFLINE: prove the S5 run-scoped decision applier is exact-tuple, plain-data, and fail-closed. */
async function runOfflineDecisionApplierUnit(): Promise<void> {
  const applierSource = await readFile(resolve(process.cwd(), 'src/autoexec/decision_applier.ts'), 'utf-8');
  assert.match(applierSource, /\.decideApproval\(/, 'S5 C2: the decision applier owns the run-scoped decideApproval call');
  assert.doesNotMatch(applierSource, /\.decide\(/, 'S5 C2: the decision applier never uses bare decide');
  assert.doesNotMatch(applierSource, /ApprovalManager/, 'S5 C2: the decision applier never imports or constructs ApprovalManager');

  for (const [thrown, expected] of [
    ['Unknown run: ses_x/run_x', 'unknown_run'],
    ['Unknown approval: approval_1', 'unknown_approval'],
    ['Approval is not pending: approval_1', 'not_pending'],
    ['filesystem exploded', 'io_error'],
  ] as const) {
    const mapped = mapHeartbeatDecisionError(new Error(thrown));
    assert.deepEqual(mapped, { ok: false, error: expected }, `S5 C4 maps ${thrown} to ${expected}`);
    assert.notDeepEqual(mapped, { ok: true, status: 'approved' }, 'S5 C4: an unknown throw never yields approved');
  }

  const roundTripRoot = await mkdtemp(join(tmpdir(), 'nova-autoexec-decision-'));
  try {
    const sessions = new SessionRunManager({ projectRoot: roundTripRoot });
    const session = await sessions.createSession({ title: 'heartbeat decision smoke', tags: ['heartbeat'] });
    const approveRun = await sessions.startRun({ sessionId: session.id, objective: 'approve smoke', input: 'heartbeat:inspection:approve' });
    const approvePending = await sessions.requestApproval(session.id, approveRun.id, { capability: 'shell', action: 'heartbeat:inspection:execute', riskLevel: 'high', reason: 'smoke approve' });
    const approveId = approvePending.approvals.at(-1)!.id;
    const applier = createHeartbeatDecisionApplier({ projectRoot: roundTripRoot });
    const approveOutcome = await applier.apply({ locator: { sessionId: session.id, runId: approveRun.id, approvalId: approveId }, decision: 'approved', reason: 'approve reason' });
    assert.deepEqual(approveOutcome, { ok: true, status: 'approved' }, 'S5 applier approve round-trip returns plain status');
    assert.doesNotMatch(JSON.stringify(approveOutcome), /ses_|run_|approval_/, 'S5 C5: approve outcome contains no RunRecord or locator');
    const approvedRun = await sessions.store.getRun(session.id, approveRun.id);
    assert.equal(approvedRun!.approvals[0]!.status, 'approved', 'S5 applier forwards the exact approval tuple for approve');
    assert.equal(approvedRun!.approvals[0]!.decisionReason, 'approve reason', 'S5 applier forwards the reason');

    const denyRun = await sessions.startRun({ sessionId: session.id, objective: 'deny smoke', input: 'heartbeat:inspection:deny' });
    const denyPending = await sessions.requestApproval(session.id, denyRun.id, { capability: 'shell', action: 'heartbeat:inspection:execute', riskLevel: 'high', reason: 'smoke deny' });
    const denyId = denyPending.approvals.at(-1)!.id;
    const denyOutcome = await applier.apply({ locator: { sessionId: session.id, runId: denyRun.id, approvalId: denyId }, decision: 'denied', reason: 'deny reason' });
    assert.deepEqual(denyOutcome, { ok: true, status: 'denied' }, 'S5 applier deny round-trip returns plain status');
    assert.doesNotMatch(JSON.stringify(denyOutcome), /ses_|run_|approval_/, 'S5 C5: deny outcome contains no RunRecord or locator');
    const deniedRun = await sessions.store.getRun(session.id, denyRun.id);
    assert.equal(deniedRun!.approvals[0]!.status, 'denied', 'S5 applier forwards the exact approval tuple for deny');
    assert.equal(deniedRun!.approvals[0]!.decisionReason, 'deny reason', 'S5 applier forwards the deny reason');
  } finally {
    await rm(roundTripRoot, { recursive: true, force: true });
  }

  console.log('autoexec:smoke offline decision applier unit passed');
}

/** OFFLINE: prove the D4.4 tool-runtime policy hook gates delegated writes. */
async function runOfflinePolicyCompositionUnit(): Promise<void> {
  const ask = () => ({ decision: 'ask' as const, ruleId: 'hb-d44-ask', reason: 'D4.4 forces an ask decision', safeMessage: 'D4.4 ask' });
  const probe: NovaTool = {
    name: 'hb-write-probe',
    description: 'D4.4 delegated write probe',
    inputSchema: z.object({ value: z.string() }),
    readOnly: false,
    async execute(input: { value: string }) { return `D44_OK:${input.value}`; },
  };
  const registry = new ToolRegistry();
  registry.register(probe);

  const allowed = registry.toAITools({ policy: { enabled: true, profileId: 'readonly', approvalProvided: true, hook: ask } });
  const allowedOut = await (allowed['hb-write-probe'] as any).execute({ value: 'unit' });
  assert.equal(String(allowedOut), 'D44_OK:unit', 'D4.4: an approved ask widens to allow and the tool executes');

  const refused = registry.toAITools({ policy: { enabled: true, profileId: 'readonly', hook: ask } });
  const refusedOut = await (refused['hb-write-probe'] as any).execute({ value: 'unit' });
  assert.match(String(refusedOut), /Policy ask/, 'D4.4: an un-approved ask is refused with the policy string');

  console.log('autoexec:smoke offline policy composition unit passed');
}

/** Read the persisted heartbeat task state for a project root (raw, no normalize). */
async function persistedTaskState(projectRoot: string, taskId: string): Promise<HeartbeatTaskState | undefined> {
  const state = JSON.parse(await readFile(new HeartbeatStore(projectRoot).paths.state, 'utf-8')) as HeartbeatState;
  return state.tasks[taskId];
}

/** LIVE: run a real granted `inspection` through the hardened sandbox end-to-end. */
async function runLiveEndToEnd(): Promise<void> {
  const liveRoot = await mkdtemp(join(tmpdir(), 'nova-autoexec-live-'));
  try {
    const taskId = 'inspect-live';
    const config: HeartbeatConfig = { enabled: true, tasks: [{ id: taskId, kind: 'inspection', action: 'inspect', schedule: { type: 'interval', everyMinutes: 60 } }] };
    const flags: HeartbeatExecutionFlags = { heartbeatExec: true, liveLlm: true, writeTools: true };
    const gateway: HeartbeatApprovalGateway = { async resolve() { return 'approved'; } };
    // The REAL Gate C: a hardened subprocess sandbox running `node --version`
    // (capability defaults), with a tight timeout so the smoke stays quick.
    const capability = createDelegatedExecutionCapability({ sandbox: createExecutionSandbox(), timeoutMs: 10_000 });

    // T0 — a due inspection with no pending grant mints an approval (no capability
    // is consulted yet because there is nothing to resolve).
    await runHeartbeatDryRunTick({ projectRoot: liveRoot, config, flags, sandboxAvailable: true, approvalGateway: gateway, now: new Date('2026-03-01T00:00:00.000Z') });
    const minted = (await persistedTaskState(liveRoot, taskId))?.pendingApprovalId;
    assert.ok(minted, 'live: the first tick mints a pending approval');

    // T1 — one minute later the grant resolves and the real sandbox executes.
    const tick = await runHeartbeatDryRunTick({ projectRoot: liveRoot, config, flags, sandboxAvailable: true, approvalGateway: gateway, capability, now: new Date('2026-03-01T00:01:00.000Z') });
    assert.equal(tick.tasks[0]!.status, 'executed', 'live: the granted task executes through the real sandbox');
    assert.equal(tick.status, 'executed', 'live: the tick status is executed');
    assert.equal(tick.dryRun, false, 'live: an executed tick is not a dry run');
    assert.equal(tick.safety.autonomousActionsExecuted, true, 'live: an autonomous action is recorded');
    // End-to-end redaction proof: the `node --version` output (a vX.Y.Z string)
    // never reaches the tick — capability drops it and redaction scrubs the reason.
    assert.doesNotMatch(JSON.stringify(tick), /v\d+\.\d+\.\d+/, 'live: the subprocess version output never leaks into the tick');

    const state = await persistedTaskState(liveRoot, taskId);
    assert.equal(state?.pendingApprovalId, undefined, 'live: a successful execution consumes the grant');
    assert.equal(state?.lastApprovalId, minted, 'live: the executed approval id is audited');
    assert.equal(state?.lastExecAt, '2026-03-01T00:01:00.000Z', 'live: lastExecAt uses the injected clock');
    assert.equal(state?.lastExecStatus, 'executed', 'live: the execution status is recorded');

    console.log('autoexec:live-smoke passed');
  } finally {
    await rm(liveRoot, { recursive: true, force: true });
  }
}

function liveOptIn(): boolean {
  if (process.argv.includes('--live')) return true;
  const flag = process.env.NOVA_HEARTBEAT_EXEC_LIVE_SMOKE;
  return flag === '1' || flag === 'true';
}

async function main(): Promise<void> {
  await runOfflineProducerUnit();
  await runOfflineBridgeUnit();
  await runOfflineDecisionApplierUnit();
  await runOfflinePolicyCompositionUnit();
  if (!liveOptIn()) {
    console.log('autoexec:live-smoke skipped (opt-in)');
    return;
  }
  await runLiveEndToEnd();
}

main().catch((err) => {
  console.error('autoexec:smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
