# Nova Memory/Knowledge with Local RAG

Memory/Knowledge turns Nova's current in-memory conversation buffer into a local-first, policy-gated knowledge system with deterministic local RAG retrieval. It is designed from real Nova usage: profiles, subagents, policy decisions, trace/eval evidence, tool behavior, and durable project knowledge should help future runs without creating uncontrolled global memory or storing sensitive artifacts.

The module is implemented in `src/memory/` as local JSON persistence plus a rebuildable `_rag_index.json` using dependency-free BM25-like chunk scoring. It remains local-first and policy-gated; remote/vector databases are not required for the final local RAG behavior.

## Goals

- Persist useful long-term knowledge under `.nova/memory/` without exposing secrets, raw traces, raw eval reports, or private workspace artifacts.
- Support scoped recall for project, workspace, profile, session, user, subagent, and capability contexts.
- Make reads and writes deterministic, auditable, schema-versioned, migratable, and recoverable.
- Integrate with Agent Profiles, `NovaAgent`, subagents, Policy/Permissions, Trace/Eval, and future MCP/LSP surfaces.
- Prefer complete, high-impact V1 behavior over a shallow file dump.

## Non-goals

- No uncontrolled global memory shared across unrelated projects.
- No raw `.nova/traces`, `.nova/evals`, `.nova/reports`, `.env`, private keys, tool dumps, or unreviewed prompts stored as memory items.
- No automatic self-modification or silent prompt edits based on memories.
- No remote vector database dependency; local deterministic RAG must work from JSON files and rebuildable indexes first.
- No remote sync by default.

## Memory types

| Type | Purpose | Typical examples | Default retention |
| --- | --- | --- | --- |
| `semantic` | Stable facts about a codebase, product, domain, or API. | "MCP V1 is read-only", "Agent Profiles have nine built-ins". | Long TTL, confidence decay. |
| `episodic` | Event or run summaries that may explain future context. | "Profiles V1 implemented on 2026-06-21". | Medium TTL, consolidate aggressively. |
| `procedural` | How-to knowledge and project conventions. | "Run `npm run typecheck` after docs/code changes". | Long TTL, high confidence when verified. |
| `profile` | User/project preferences and profile contracts. | Preferred language, output style, profile memory scopes. | Long TTL, approval required. |
| `decision` | Architecture/product choices and rationale. | "Use local JSON index before vector store". | Long TTL, archive not delete by default. |
| `finding` | Evidence-backed observations, bugs, risks, or eval insights. | "Raw eval artifacts must never be imported". | Medium TTL until resolved/consolidated. |

## Scope model

Every memory item has one primary `scope.kind` and optional qualifiers. Scope controls both retrieval and writes.

| Scope | Meaning | Example qualifier |
| --- | --- | --- |
| `project` | Knowledge bound to one repository/project root. | `projectId`, normalized root fingerprint. |
| `workspace` | Knowledge shared across projects inside one workspace. | workspace path fingerprint. |
| `profile` | Knowledge tied to an Agent Profile. | `profileId`, `profileVersion`. |
| `session` | Short-lived run/conversation memory. | `sessionId`, expires quickly. |
| `user` | Explicit user preferences reusable across projects. | local user id/profile only. |
| `subagent` | Delegated-worker-specific context. | `delegationId`, role. |
| `capability` | Knowledge tied to a capability/tool surface. | `read`, `mcp`, `lsp`, `eval`, `trace`, etc. |

There is no implicit global read. Cross-scope retrieval must be explicitly allowed by policy and profile contracts.

## Documentation map

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data flow, integration points, architecture decisions. |
| [PERSISTENCE.md](PERSISTENCE.md) | `.nova/memory` layout, schemas, versioning, migrations, atomic writes, index rebuild. |
| [SECURITY.md](SECURITY.md) | Secret handling, raw artifact denial, prompt injection, poisoning, import/export safety. |
| [RETRIEVAL.md](RETRIEVAL.md) | Retrieval timing, ranking, token budgets, stale handling, policy gates, untrusted wrappers. |
| [LIFECYCLE.md](LIFECYCLE.md) | Write policy, retention, TTL, confidence decay, consolidation, archive/delete. |
| [EVAL.md](EVAL.md) | Smoke tests, eval scenarios, acceptance criteria, trace/eval integration. |
| [BACKLOG_V1_1.md](BACKLOG_V1_1.md) | Future improvements after a complete V1 baseline. |

## Built-in collections

V1 starts with curated local collections, all under `.nova/memory/collections/` and indexed in `_index.json`:

- `project_knowledge`: semantic facts and project-specific conventions.
- `architecture_decisions`: decision memories with rationale and links to docs/ADRs.
- `procedures`: procedural memories for verified commands and workflows.
- `user_profile`: explicit user preferences; stricter approval and export controls.
- `agent_profiles`: profile contracts and profile-scoped defaults.
- `subagent_findings`: bounded subagent discoveries that passed validation.
- `eval_findings`: sanitized, metadata-only eval/trace insights; never raw reports.
- `security_findings`: security-sensitive findings with restrictive retrieval defaults.
- `imports_quarantine`: imported memories pending validation, redaction, and approval.
- `archive`: inactive memories retained for audit or historical rationale.

## Local RAG behavior

- `items/` JSON files remain the source of truth.
- `_index.json` stores safe metadata for lifecycle/scope/filtering.
- `_rag_index.json` stores sanitized chunks, term frequencies, document frequencies, and an integrity hash.
- Retrieval first applies policy/scope/collection/security filters, then blends metadata ranking with local RAG chunk hits.
- RAG snippets are injected only inside the existing untrusted memory wrapper.
- The CLI exposes `nova memory add|list|show|search|retrieve|rag status|rag rebuild|rag search|doctor` without invoking the LLM.

## Acceptance summary

Memory/Knowledge V1 is acceptable only when:

1. Scope gates prevent uncontrolled global recall.
2. Writes follow propose -> validate -> secret scan -> raw artifact reject -> redact -> duplicate/hash -> policy gate -> approval -> persist -> audit.
3. Retrieval wraps all persisted memory as untrusted context and obeys profile/policy/token budgets.
4. Persistence supports schema versioning, migrations, stable fingerprints, atomic writes, and index rebuild.
5. Local RAG search ranks relevant chunks without external services or dependencies.
6. Smoke/eval coverage proves secrets/raw artifacts are refused and useful scoped memories are retrieved.
