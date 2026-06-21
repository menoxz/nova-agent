# Memory/Knowledge V1 Architecture

## Position in Nova

Nova already has `ConversationMemory`, Agent Profiles, Sub-agent Orchestration, Policy/Permissions, Trace/Eval, MCP, and LSP. Memory/Knowledge V1 becomes a shared local service used by those modules without giving them unchecked authority.

```text
User/session input
  -> NovaAgent
    -> Profile resolver decides memory contract
    -> Policy gates memory read/write capability
    -> Memory retrieval builds untrusted context bundle
    -> LLM/tool loop runs with retrieved context
    -> Candidate memories are proposed from outputs/findings
    -> Write pipeline validates, redacts, dedupes, gates, audits
    -> .nova/memory persists items and indexes atomically
```

## Architectural decisions adopted

1. **Local JSON first, no vector dependency in V1** — deterministic files and indexes are easier to inspect, migrate, test, and secure. Vector/RAG can be added after baseline correctness.
2. **Scoped memory, never uncontrolled global memory** — every item has an explicit scope, and retrieval requires profile + policy permission.
3. **Memory as untrusted context** — retrieved memories are evidence, not instructions. They are wrapped and ranked before prompt injection.
4. **Policy-gated write path** — memory is a mutable capability and therefore uses `ask`/approval semantics, secret scanning, denylist checks, and metadata-only audit.
5. **No raw artifact ingestion** — `.env`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, private keys, full tool outputs, and raw prompts are refused even when local.
6. **Schema versioning from day one** — item, index, collection, audit, import/export, and archive records include schema versions and migration metadata.
7. **Index can be rebuilt from items** — `_index.json` improves lookup speed but is not the source of truth.
8. **Hash/fingerprint identity** — normalized content, scope, type, collection, and source metadata produce stable duplicates detection without storing raw sensitive inputs.

## Components

| Component | Responsibility |
| --- | --- |
| `MemoryService` | Public read/write/search/consolidate API for Nova modules. |
| `MemoryStore` | Filesystem persistence under `.nova/memory` with atomic writes. |
| `MemoryIndex` | Rebuildable metadata index, ranking fields, collection summaries. |
| `MemoryPolicyAdapter` | Calls Policy/Permissions for `memory` capability checks. |
| `MemoryRetriever` | Selects collections/scopes, ranks, budgets, stale-handles, wraps context. |
| `MemoryWriter` | Implements the write pipeline and approval handoff. |
| `MemoryLifecycle` | TTL, confidence decay, stale detection, consolidation, archive/delete. |
| `MemoryImportExport` | Safe portable bundles with quarantine and revalidation. |
| `MemoryEvalHooks` | Smoke/eval scenarios and sanitized trace/eval findings. |

These names are conceptual for implementation planning; V1 docs do not implement code.

## Integration points

### Agent Profiles

Profiles already define `memory.scope`, `readCollections`, `writeCollections`, and retention placeholders. V1 makes those fields authoritative:

- profile-selected collections are defaults, not unconditional access;
- profile memory scope narrows retrieval and candidate writes;
- profile mode (`root`, `subagent`, `tool_worker`) affects allowed memory operations;
- profile hashes and versions are copied into memory provenance.

### NovaAgent

`NovaAgent` keeps short-term conversation state, but V1 adds a pre-step retrieval phase and post-step candidate write phase:

1. Build `MemoryQueryContext` from prompt, project root, active profile, actor, delegation, tool constraints, and current session.
2. Retrieve bounded memories before the LLM call.
3. Inject the returned bundle under an explicit untrusted context boundary.
4. Propose candidate memories after final answer/tool observations, but do not persist without the write pipeline.

### Subagents

Subagents receive only memory allowed by parent grant ∩ role default ∩ policy profile ∩ profile memory contract. Subagent writes default to `finding` or `episodic` candidates and require parent/approval flow before persistence. Subagents cannot read user/profile memory unless specifically granted.

### Policy/Permissions

The `memory` capability remains ask-gated in trusted profiles and denied in read-only/CI profiles where appropriate. Policy checks are required for:

- retrieval from non-session scopes;
- writes to persistent collections;
- imports/exports;
- archive/delete operations;
- retrieval of security/user/profile collections.

### Eval/Trace

Trace/eval output may inform memory but is never imported raw. Only sanitized findings are eligible:

- pass/fail metadata;
- scenario id/suite id;
- concise human-readable finding;
- no raw prompts, raw tool outputs, raw reports, or trace files.

### MCP/LSP future surfaces

MCP/LSP may expose memory only as curated metadata or explicit tools/resources after separate policy review. V1 keeps MCP/LSP read-only defaults intact and does not expose `.nova/memory` raw files.

## Default flow

```text
retrieve:
  request -> resolve profile memory contract -> policy gate -> collection/scope filter
  -> keyword/metadata candidate search -> rank -> stale/confidence adjust
  -> token budget pack -> untrusted wrapper -> prompt context

write:
  candidate -> validate schema -> scan secrets -> reject raw artifacts -> redact
  -> normalize/hash/fingerprint -> duplicate check -> policy gate -> approval
  -> atomic item write -> index update -> metadata-only audit
```

## Failure posture

- Retrieval failure should degrade to no long-term memory, not fail the whole agent run, unless a command explicitly requires memory.
- Write failure should never lose the agent's answer; it should produce a warning/audit event.
- Corrupt index should trigger rebuild from items.
- Corrupt item should be quarantined or ignored with safe metadata, not loaded into prompt context.
