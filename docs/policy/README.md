# Nova Policy/Permissions V1

Policy V1 centralizes safety decisions for Nova tools and read-only server surfaces without enabling new write or shell capabilities by default.

## Shared core

- `src/policy/types.ts` defines actor/delegation/capability/profile/request/decision/audit contracts, including Sub-agent Contract Spec V0 fields as types only.
- `profiles.ts` provides `readonly`, `developer`, `trusted-local`, `ci-eval`, and a non-default `future-autonomous` placeholder.
- `rules.ts` evaluates deterministic allow/deny/ask rules in order: no silent escalation, child delegation cannot exceed parent scope, sensitive paths/content are denied, mutating/shell capabilities ask unless explicitly approved.
- `path.ts`, `redact.ts`, `output.ts`, and `errors.ts` provide reusable safe path, redaction/refusal, truncation, and safe error helpers.
- `audit.ts` creates metadata-only audit events; raw file contents, env values, traces, and eval reports are not copied into policy audit records.

## Default posture

- Safe reads are allowed under configured roots.
- `.env`, `.git`, `node_modules`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, traversal, outside-root paths, secret-like filenames, and private-key material are denied.
- `write_file` and `bash` are not enabled by policy; if a ToolRegistry policy hook is configured, `deny` and `ask` decisions prevent execution unless an explicit approval integration is provided.
- MCP V1 and LSP V1 remain read-only; V1.1 HTTP and full sub-agent orchestration are out of scope.

## Read-only command audit V1

`src/security/read_only_matrix.ts` is the authoritative local/offline safety matrix for representative CLI commands, package scripts, built-in tools, and blocked high-risk categories. Entries classify pure read-only paths, metadata-writing dry-runs/smokes, sensitive read surfaces, mutating commands, live provider paths, and dangerous blocked categories.

Terminology in this matrix is intentionally split:

- `pure-read-only` means the entry has no filesystem writes, dotenv/secret exposure, provider calls, agent creation, or tool registration/execution.
- `orchestratorReadOnlyCompatible: true` means the entry is safe for orchestrator validation because it is local, offline, non-live, and policy-bounded. It may still write temporary/report metadata or instantiate mock/local validation components such as stdio servers, mock agents, or read-only tool surfaces; those entries are not `pure-read-only`.

Orchestrator-compatible entries must not invoke live providers, use network, perform shell/git mutation, read raw sensitive artifacts, or expose `.env`/secret values. Metadata-writing dry-runs and offline smokes are called out separately from `pure-read-only`.

Run:

```bash
npm run policy:smoke
npm run security:readonly-audit
npm run security:readonly-smoke
npm run eval:policy
```

The policy smoke verifies safe read allow, sensitive path/content denial, redaction, child-capability denial, and write/shell ask behavior. The security audit/smoke scripts verify that the matrix keeps live provider, daemon/autonomy, publish/tag/push/PR, raw artifact, shell, write, and mutating tool paths out of read-only classifications.
