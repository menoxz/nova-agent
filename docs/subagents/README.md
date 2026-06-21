# Nova Sub-agent Orchestration V1

Nova subagents are **bounded delegated workers**, not autonomous agents. V1 exists only to deliver five values:

1. **Specialization** — each worker has one role: researcher, architect, builder, reviewer, security, qa, docs, or refactor.
2. **Risk isolation** — a child receives only the intersection of parent grant, role default grant, and active policy profile.
3. **Independent verification** — producer tasks cannot self-verify; reviewer/qa/security work must be separate delegated tasks.
4. **Context management** — workers receive allowlisted context with caps, redaction, and omission metadata.
5. **Parallelism** — only independent read-only/non-overlapping DAG tasks are eligible for fan-out.

## Safety model

- No recursive sub-agent spawning in V1.
- No role grants `write` or `shell` by default; those remain Policy `ask`/approval concerns outside V1 defaults.
- Every worker tool call is executed with `ActorContext` and `DelegationContext` propagated through `ToolRegistry`.
- Context denies traversal, outside-root access, `.env`, `.git`, `node_modules`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, private-key material, and secret-like filenames.
- Lifecycle trace events are sanitized metadata only: actor/delegation/task/role/status, never raw secrets or raw `.nova` content.

## Module map

`src/subagents/` contains contracts, role registry, authority derivation, DAG task graph, context builder, budget guard, worker wrapper, orchestrator, trace recorder, smoke test, and public exports.

## Commands

```bash
npm run subagents:smoke
npm run eval:subagents
```
