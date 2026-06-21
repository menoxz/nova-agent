# Memory/Knowledge V1.1 Backlog

V1.1 should build on a complete, secure V1 baseline. Do not start these items until scoped persistence, retrieval, lifecycle, security, and eval acceptance are implemented and passing.

## Retrieval improvements

- Optional local embeddings/vector index for large repositories, behind feature flag and with deterministic JSON fallback.
- Hybrid ranking that blends BM25/keyword, metadata, and embeddings.
- Conflict clustering and side-by-side surfacing of competing decisions.
- Better source-aware freshness checks from git/docs changes.

## UX and approval

- CLI review queue for proposed memories.
- Diff-style display for consolidation/merge operations.
- User-facing commands to list, inspect, archive, delete, import, and export memories safely.
- Per-profile memory dashboards.

## Policy/security

- Stronger high-entropy detection with tuned false-positive controls.
- Signed export bundles.
- Optional encrypted local store for `user_profile` and security-sensitive collections.
- Memory poisoning eval suite with adversarial imported memories.
- More granular policy profiles for memory read/write/import/export/archive/delete.

## Integrations

- MCP resources/tools for curated memory summaries only, gated separately.
- LSP diagnostics/hover for memory-backed project conventions without exposing raw store files.
- Agent Profile editor integration for memory contracts.
- Eval-driven suggested memories with human review queue.

## Operations

- Store compaction and archive rotation.
- `memory doctor` command for index integrity, orphan detection, and safe repair.
- Export/import compatibility matrix across schema versions.
- Documentation examples for common workflows.

## Still out of scope until explicitly approved

- Remote/cloud synchronization.
- Organization-wide global memory.
- Autonomous profile/user preference writes without approval.
- Raw trace/eval/report ingestion.
- Training/fine-tuning datasets generated from local memories.
