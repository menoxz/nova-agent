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

## Verification

Run:

```bash
npm run policy:smoke
npm run eval:policy
```

The smoke script verifies safe read allow, sensitive path/content denial, redaction, child-capability denial, and write/shell ask behavior.
