/**
 * Smoke suite for the delegated execution seam (ADR-002 Heartbeat V3, Slice 4).
 *
 * Two layers, gated so the default `check` pipeline never spawns a real process:
 *
 *  1. OFFLINE producer unit — ALWAYS runs. It drives
 *     {@link createDelegatedExecutionCapability} with FAKE {@link ExecutionSandbox}
 *     instances whose results carry sentinel stdout/stderr bodies, then proves
 *     CAVEAT-5: the `SandboxExecResult` → `HeartbeatExecOutcome` mapping keeps
 *     metadata only (exit code + duration) and DROPS the output bodies, the ok
 *     mapping is `exitCode === 0 && !timedOut && !truncated`, and a sandbox throw
 *     is caught at the seam and reported as a metadata-only `{ ok: false }`.
 *
 *  2. LIVE end-to-end — OPT-IN via `--live` or `NOVA_HEARTBEAT_EXEC_LIVE_SMOKE`
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
import { join } from 'node:path';

import { createDelegatedExecutionCapability } from './capability.js';
import { createExecutionSandbox } from '../sandbox/sandbox.js';
import type { ExecutionSandbox, SandboxExecResult } from '../sandbox/types.js';
import { runHeartbeatDryRunTick } from '../heartbeat/runner.js';
import { HeartbeatStore } from '../heartbeat/store.js';
import type { HeartbeatApprovalGateway } from '../heartbeat/executor.js';
import type { HeartbeatExecutionFlags } from '../heartbeat/execution_gate.js';
import type { HeartbeatConfig, HeartbeatState, HeartbeatTaskState } from '../heartbeat/types.js';

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
