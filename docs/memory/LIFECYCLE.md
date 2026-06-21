# Memory Write and Lifecycle Policy

## Write pipeline

All persistent writes follow the mandatory pipeline:

```text
propose
  -> validate
  -> secret scan
  -> raw artifact reject
  -> redact
  -> duplicate/hash
  -> policy gate
  -> approval
  -> persist
  -> audit
```

### 1. Propose

Candidates may come from the user, root agent, subagent, eval finding, sanitized trace summary, or import bundle. A proposal includes intended type, collection, scope, source, confidence, importance, and summary.

### 2. Validate

Validation checks schema, content length, supported memory type, supported collection, scope completeness, source metadata, lifecycle defaults, and implementation limits.

### 3. Secret scan

Scan all candidate fields for secret-like keys, values, paths, and high-entropy strings. Rejection is safer than over-redaction for credentials.

### 4. Raw artifact reject

Reject raw `.nova/traces`, `.nova/evals`, `.nova/reports`, `.env`, `.git`, `node_modules`, private keys, copied raw tool outputs, raw LLM transcripts, and full eval reports.

### 5. Redact

Apply deterministic redaction only when the remaining content is still useful and non-sensitive. Mark redacted items explicitly.

### 6. Duplicate/hash

Normalize content and compute `contentHash` + `fingerprint`. If a duplicate exists:

- update verification/last-seen metadata if useful;
- merge tags cautiously;
- do not create near-identical items.

### 7. Policy gate

Ask Policy/Permissions for `memory` write access with actor, profile, delegation, scope, collection, and sensitivity.

### 8. Approval

Persistent writes require approval when policy returns `ask`, when writing `profile`/`user_profile`/`security_findings`, when importing, or when confidence is low but impact is high.

### 9. Persist

Write the item atomically, update collection/index projections, and ensure index remains rebuildable.

### 10. Audit

Append metadata-only audit event. Never include raw content in audit.

## Retention defaults

| Type | Default TTL | Decay | Archive behavior |
| --- | --- | --- | --- |
| `semantic` | 180-365 days | Slow confidence decay unless verified. | Archive when stale and unused. |
| `episodic` | 30-90 days | Medium decay. | Consolidate into semantic/finding or archive. |
| `procedural` | 180-365 days | Slow; stale when commands/files change. | Archive only after replacement. |
| `profile` | 365+ days | No automatic decay without review. | Archive previous versions. |
| `decision` | 365+ days | No automatic decay; can be superseded. | Archive superseded decisions, preserve rationale. |
| `finding` | 30-180 days | Medium; resolved findings decay faster. | Archive resolved or consolidated findings. |

Exact TTLs may be profile/collection-specific.

## Confidence decay

Confidence decreases over time when memories are not verified or used:

- small periodic decay for active semantic/procedural memories;
- faster decay for episodic/finding memories;
- no silent deletion solely because confidence decayed;
- retrieval score includes confidence and staleness penalties.

Verification events can increase confidence when current repository evidence or user confirmation supports the memory.

## Stale detection

Mark memories stale when:

- TTL expires;
- source file/docs referenced by the memory changed materially;
- profile version/hash changed;
- eval baseline changed;
- conflicting newer decision exists;
- import origin is untrusted or unsupported;
- repeated retrieval produces no utility.

Stale items remain persisted until archive/delete policy runs.

## Consolidation

Consolidation reduces clutter and improves quality:

- merge repeated episodic run summaries into one semantic/procedural memory;
- promote recurring eval findings into procedural guidance;
- link related decisions/findings;
- mark superseded items rather than deleting them immediately;
- preserve provenance and audit metadata.

Consolidation itself follows the write pipeline and may require approval.

## Archive and delete

Archive moves an item to `.nova/memory/archive/` and removes it from active retrieval. Delete removes it from normal storage and writes a tombstone/audit event.

Use archive by default for:

- superseded decisions;
- resolved findings with historical value;
- old profile versions;
- imported items replaced by local verified items.

Use delete for:

- accidental sensitive persistence;
- corrupt/unreadable items that cannot be safely archived;
- user-requested erasure;
- policy-mandated removal.

Sensitive delete should also rebuild indexes and verify no redacted secret remains in projections or exports.
