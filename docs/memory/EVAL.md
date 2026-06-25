# Memory Smoke and Eval Plan

Memory/Knowledge must ship with deterministic smoke tests and mock evals before any live or autonomous use.

## Smoke acceptance criteria

Smoke coverage should prove:

1. `.nova/memory` initializes only when memory is explicitly used, not at unrelated startup.
2. A safe semantic project memory can be proposed, approved, persisted, indexed, retrieved, and wrapped as untrusted context.
2a. A deterministic local RAG index can be rebuilt and ranks relevant sanitized chunks for retrieval.
3. `.env`, private-key material, secret-like values, raw `.nova/traces`, raw `.nova/evals`, and raw `.nova/reports` are rejected.
4. Session/profile/project scopes do not leak into each other.
5. Duplicate fingerprint detection prevents duplicate item creation.
6. `_index.json` can be rebuilt from `items/`.
7. Corrupt/unsupported items are skipped/quarantined safely.
8. Archive/delete updates index projections and audit metadata without raw content.
9. Policy `deny` and `ask` decisions prevent retrieval/write unless approved.
10. Import bundles enter quarantine and require validation/approval.

## Eval scenarios

Suggested deterministic mock scenarios:

| Scenario | Purpose | Pass condition |
| --- | --- | --- |
| `memory-scoped-recall` | Retrieve project memory only for matching project. | Correct memory included, unrelated project omitted. |
| `memory-local-rag-search` | Search sanitized chunks without external services. | Relevant chunk ranks first and returns safe snippet only. |
| `memory-profile-contract` | Honor Agent Profile `readCollections`/`writeCollections`. | Disallowed collection omitted/refused. |
| `memory-secret-refusal` | Reject secrets and raw artifacts. | Candidate rejected with safe reason, no item/index body. |
| `memory-untrusted-wrapper` | Ensure prompt wrapper exists. | Retrieved block states memory is untrusted context. |
| `memory-duplicate-fingerprint` | Avoid duplicate persistence. | Existing item updated/linked, no duplicate id. |
| `memory-stale-handling` | Lower rank or omit stale high-impact memory. | Stale marker/omission reason present. |
| `memory-index-rebuild` | Recover from missing/corrupt index. | Rebuilt index has expected safe metadata. |
| `memory-import-quarantine` | Validate import safety. | Imported items not active before approval. |
| `memory-subagent-boundary` | Enforce delegated scope. | Subagent sees only delegated findings/context. |
| `memory-eval-finding-sanitize` | Store sanitized eval finding only. | No raw eval report/trace content persisted. |

## Quality gates

Memory evals should require:

- 100% pass rate for smoke/security scenarios;
- zero raw secret/raw artifact persistence;
- zero scope leakage;
- deterministic output in mock mode;
- no outside-root writes;
- no raw `.nova` artifact exposure in reports;
- index rebuild idempotence.

## Trace/Eval integration

Trace/eval systems may contribute only sanitized `finding` candidates. Accepted fields:

- suite/scenario id;
- pass/fail/error count metadata;
- compact diagnosis;
- proposed procedural/decision follow-up;
- trace/eval run id as opaque reference only.

Rejected fields:

- raw prompts;
- raw model responses;
- raw tool inputs/outputs;
- raw `report.json` or trace files;
- environment variables or filesystem dumps.

## Manual verification checklist

Before marking V1 implemented:

```bash
npm run typecheck
npm run policy:smoke
npm run profiles:smoke
npm run subagents:smoke
npm run eval:policy
npm run eval:profiles
npm run eval:subagents
npm run memory:smoke
npm run eval:memory
```

## Regression concerns

- Memory must not weaken existing MCP/LSP read-only and denylist behavior.
- Memory must not make policy `ask` actions execute without approval.
- Memory must not create `.nova` directories during unrelated read-only startup.
- Memory must not change eval reports to include raw memory bodies.
- Memory retrieval must remain optional and degrade safely.
