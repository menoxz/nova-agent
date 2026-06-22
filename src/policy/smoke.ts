#!/usr/bin/env node

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createPolicyAuditEvent } from './audit.js';
import { evaluatePolicy } from './engine.js';
import { getPolicyProfile, listSelectablePolicyProfiles } from './profiles.js';
import { containsPrivateKeyMaterial, redactString, redactUnknown } from './redact.js';
import { capText } from './output.js';
import { resolvePolicyPath } from './path.js';
import type { CapabilityCategory, PolicyRequest } from './types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    actor: { actorId: 'smoke-root', actorType: 'root_agent', sessionId: 'policy-smoke' },
    profileId: 'readonly',
    capability: 'read',
    action: 'smoke',
    readOnly: true,
    ...overrides,
  };
}

function expectDecision(label: string, req: PolicyRequest, expected: 'allow' | 'deny' | 'ask') {
  const actual = evaluatePolicy(req);
  assert(actual.decision === expected, `${label}: expected ${expected}, got ${actual.decision} (${actual.ruleId}: ${actual.reason})`);
  return actual;
}

async function main(): Promise<void> {
  const tmpRoot = join(process.cwd(), 'tmp', `nova-policy-smoke-${Date.now()}`);
  await mkdir(tmpRoot, { recursive: true });
  try {
    const safeFile = join(tmpRoot, 'safe.txt');
    const keyFile = join(tmpRoot, 'key-content.txt');
    await writeFile(safeFile, 'hello policy smoke\n', 'utf-8');
    await writeFile(keyFile, '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic\n-----END OPENSSH PRIVATE KEY-----\n', 'utf-8');

    const roots = [tmpRoot];
    assert(resolvePolicyPath(safeFile, 'safe file', roots).ok, 'safe read path should resolve');
    for (const [label, path] of [
      ['traversal', '../package.json'],
      ['outside root', resolve(process.cwd(), 'package.json')],
      ['NUL path', `${safeFile}\0suffix`],
      ['.env', join(tmpRoot, '.env')],
      ['.env.local', join(tmpRoot, '.env.local')],
      ['.git', join(tmpRoot, '.git/config')],
      ['mixed separators .git', `${tmpRoot.replace(/\\/g, '/')}/nested\\.git/config`],
      ['node_modules', join(tmpRoot, 'node_modules/pkg/index.js')],
      ['raw .nova traces', join(tmpRoot, '.nova/traces/run.json')],
      ['raw .nova evals', join(tmpRoot, '.nova/evals/report.json')],
      ['raw .nova reports', join(tmpRoot, '.nova/reports/report.json')],
      ['private key filename', join(tmpRoot, 'fake-private.pem')],
      ['secret-like filename', join(tmpRoot, 'api_key.txt')],
    ] as const) {
      assert(!resolvePolicyPath(path, label, roots).ok, `${label} should be denied`);
    }

    expectDecision('safe read', request({ path: safeFile }), 'allow');
    expectDecision('policy deny traversal', request({ path: '../package.json' }), 'deny');
    expectDecision('policy deny outside root', request({ path: resolve(process.cwd(), '..', 'outside.txt') }), 'deny');
    expectDecision('policy deny multi-path', request({ paths: [safeFile, join(tmpRoot, '.env.local')] }), 'deny');
    expectDecision('deny private key content', request({ contentPreview: await import('node:fs/promises').then((fs) => fs.readFile(keyFile, 'utf-8')) }), 'deny');

    const childCapability: CapabilityCategory = 'shell';
    expectDecision('deny child exceeds parent', request({
      actor: { actorId: 'smoke-child', actorType: 'sub_agent', parentActorId: 'smoke-root', delegationId: 'del-1' },
      delegation: { delegationId: 'del-1', parentActorId: 'smoke-root', capabilities: ['read'], tools: ['read_file'] },
      capability: childCapability,
      toolName: 'bash',
      readOnly: false,
    }), 'deny');

    expectDecision('ask write default', request({ capability: 'write', toolName: 'write_file', readOnly: false, path: safeFile }), 'ask');
    expectDecision('ask shell default', request({ capability: 'shell', toolName: 'bash', readOnly: false }), 'ask');
    assert(!listSelectablePolicyProfiles().some((profile) => profile.id === 'trusted-local'), 'trusted-local must not be selectable by default');
    expectDecision('trusted-local asks write', request({ profileId: 'trusted-local', capability: 'write', toolName: 'write_file', readOnly: false, path: safeFile }), 'ask');
    expectDecision('trusted-local asks shell', request({ profileId: 'trusted-local', capability: 'shell', toolName: 'bash', readOnly: false }), 'ask');
    expectDecision('trusted-local asks network', request({ profileId: 'trusted-local', capability: 'network', toolName: 'web_search', readOnly: true }), 'ask');
    expectDecision('trusted-local asks memory', request({ profileId: 'trusted-local', capability: 'memory', toolName: 'todo', readOnly: false }), 'ask');
    expectDecision('ci-eval denies write', request({ profileId: 'ci-eval', capability: 'write', toolName: 'write_file', readOnly: false, path: safeFile }), 'deny');
    expectDecision('ci-eval denies shell', request({ profileId: 'ci-eval', capability: 'shell', toolName: 'bash', readOnly: false }), 'deny');
    expectDecision('ci-eval denies network', request({ profileId: 'ci-eval', capability: 'network', toolName: 'web_fetch', readOnly: true }), 'deny');
    expectDecision('ci-eval denies memory', request({ profileId: 'ci-eval', capability: 'memory', toolName: 'memory_write', readOnly: false }), 'deny');
    expectDecision('future-autonomous denied', request({ profileId: 'future-autonomous', capability: 'read', path: safeFile }), 'deny');

    const redacted = redactString('token=synthetic_token_value_12345 password=synthetic_password_12345');
    assert(redacted.includes('<redacted>'), 'synthetic secrets should be redacted');
    assert(!redacted.includes('synthetic_token_value_12345'), 'synthetic token value leaked');
    const redactedUnknown = redactUnknown({ token: 'synthetic_token_value_12345', nested: { value: 'sk-policySmokeSecret1234567890' }, list: [1, 2, 3] }, { maxArrayItems: 2 });
    assert(!JSON.stringify(redactedUnknown).includes('synthetic_token_value_12345'), 'redactUnknown redacts secret-like keys');
    assert(!JSON.stringify(redactedUnknown).includes('sk-policySmokeSecret1234567890'), 'redactUnknown redacts secret-like string values');
    assert(JSON.stringify(redactedUnknown).includes('truncated 1 items'), 'redactUnknown caps arrays');
    const capped = capText('x'.repeat(1500), 1000);
    assert(capped.truncated && capped.text.includes('truncated 500 chars'), 'capText reports truncation');
    assert(containsPrivateKeyMaterial('-----BEGIN PRIVATE KEY-----\nsynthetic'), 'private key detector should match');

    const profile = getPolicyProfile('readonly');
    const audit = createPolicyAuditEvent(request({ path: safeFile }), expectDecision('audit safe read', request({ path: safeFile }), 'allow'), profile);
    assert(audit.decision === 'allow' && audit.profileId === 'readonly' && !JSON.stringify(audit).includes('hello policy smoke'), 'audit event must be sanitized metadata only');

    console.log('Policy smoke passed: allow safe read; deny traversal/outside-root/.env/.git/node_modules/raw .nova/private-key; redact secrets; deny child escalation; ask write/shell.');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
