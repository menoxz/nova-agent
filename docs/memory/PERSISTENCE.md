# Memory Persistence Plan

## Root layout

All persistent memory lives under the project-local `.nova/memory/` directory by default. This directory is local runtime state and must remain gitignored.

```text
.nova/
  memory/
    _index.json
    _audit.jsonl
    _lock
    items/
      <yyyy>/<mm>/<itemId>.json
    collections/
      project_knowledge.json
      architecture_decisions.json
      procedures.json
      user_profile.json
      agent_profiles.json
      subagent_findings.json
      eval_findings.json
      security_findings.json
      imports_quarantine.json
    archive/
      <yyyy>/<mm>/<itemId>.json
    import/
      incoming/
      rejected/
      accepted/
    export/
      <bundleId>/
```

`items/` is the source of truth. `collections/*.json` and `_index.json` are rebuildable projections.

## Memory item schema

Each item should include at least:

```json
{
  "schemaVersion": 1,
  "id": "mem_...",
  "type": "semantic",
  "collection": "project_knowledge",
  "scope": {
    "kind": "project",
    "projectId": "...",
    "workspaceId": "...",
    "profileId": "nova.architect",
    "sessionId": "...",
    "subagentRole": "architect",
    "capability": "mcp"
  },
  "content": {
    "title": "Short title",
    "summary": "Sanitized durable knowledge",
    "body": "Optional concise detail, still sanitized",
    "tags": ["architecture", "memory"]
  },
  "source": {
    "kind": "user|agent|subagent|eval|trace_summary|import|manual",
    "actorId": "...",
    "profileId": "...",
    "profileVersion": "...",
    "profileHash": "...",
    "createdFrom": "sanitized-summary-only"
  },
  "quality": {
    "confidence": 0.8,
    "importance": 0.6,
    "lastVerifiedAt": "2026-06-21T00:00:00.000Z",
    "staleAfter": "2026-09-21T00:00:00.000Z"
  },
  "lifecycle": {
    "status": "active",
    "ttlDays": 180,
    "createdAt": "2026-06-21T00:00:00.000Z",
    "updatedAt": "2026-06-21T00:00:00.000Z",
    "archivedAt": null
  },
  "integrity": {
    "contentHash": "sha256:...",
    "fingerprint": "sha256:...",
    "schemaHash": "sha256:..."
  },
  "security": {
    "redacted": false,
    "secretScan": "passed",
    "rawArtifactRejected": false,
    "untrusted": true
  }
}
```

## Index schema

`_index.json` is optimized for search and rebuildability:

- `schemaVersion`
- `generatedAt`
- `storeVersion`
- `items[]` metadata only: id, type, collection, scope keys, tags, title, summary preview, confidence, importance, timestamps, hashes, status
- `collections[]` counts and last-updated timestamps
- `migrations[]` applied migration ids
- `integrity` for index hash and item count

The index must not contain raw secret-like content or full item bodies.

## Collections

Collection files are curated manifests, not separate sources of truth. They contain:

- collection id/name/description;
- allowed memory types;
- default scope restrictions;
- default TTL/retention;
- default retrieval priority;
- list of item ids or queryable metadata.

## Versioning and migrations

V1 uses `schemaVersion: 1` for all memory objects. Migrations are explicit and idempotent:

1. Read object.
2. Validate version and shape.
3. Apply sequential migration functions.
4. Recompute schema hash/content hash/fingerprint.
5. Write atomically.
6. Append metadata-only audit event.

Unsupported future versions are not loaded into retrieval context; they are reported as safe metadata and left untouched unless a compatible migrator exists.

## Hashes and fingerprints

- `contentHash`: hash of normalized sanitized content.
- `fingerprint`: hash of normalized content + type + collection + primary scope + stable source hints.
- `schemaHash`: hash of the canonical schema version/shape.
- `bundleHash`: export/import bundle integrity hash.

Duplicate detection uses `fingerprint` first, then content similarity within the same scope and collection.

## Atomic writes

All writes follow safe local persistence:

1. Resolve path under `.nova/memory`; reject traversal/outside-root.
2. Serialize canonical JSON with stable key ordering where feasible.
3. Write to `*.tmp` in the same directory.
4. Flush/fsync where supported.
5. Rename tmp -> final path atomically.
6. Update index through the same tmp/rename pattern.
7. Append audit as JSONL with redacted metadata only.

Concurrent writes should use a best-effort lock file (`_lock`) with timeout and stale-lock recovery.

## Index rebuild

Rebuild should be available as an implementation command/API:

1. Scan `items/` and `archive/`.
2. Validate each item.
3. Ignore/quarantine corrupt or unsupported items.
4. Reconstruct collections and `_index.json`.
5. Emit safe rebuild report: counts, skipped ids, reasons, no raw content.

Rebuild must never inspect `.env`, `.git`, `node_modules`, raw traces, raw evals, or raw reports.

## Import/export

Exports are sanitized bundles, not filesystem copies:

- include schema version, bundle metadata, safe collection manifests, item JSON, hash manifest;
- exclude audit logs by default;
- exclude archive by default unless explicitly requested;
- require approval for `user_profile`, `security_findings`, or cross-project bundles.

Imports always enter `imports_quarantine` first and re-run validation, redaction, raw artifact rejection, duplicate detection, scope remapping, policy gate, and approval.
