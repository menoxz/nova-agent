# MCP Security Policy

## Scope

Nova MCP V1 is a local read-only stdio server. The default allowed root is the project root; extra roots may be supplied with `NOVA_MCP_ALLOWED_ROOTS` but deny rules still win.

## Denylist precedence

Denied paths are refused even when they are under an allowed root:

- `.env`, `.env.*`
- `.git` internals, including config/credentials/hooks
- `node_modules`
- `.nova/traces`, `.nova/evals`, `.nova/reports` raw artifacts
- private-key extensions (`.pem`, `.key`, `.p12`, `.pfx`, `.ppk`, `.asc`, `.gpg`)
- filenames matching secret/token/credential/API-key/password/private-key patterns

Path traversal with `..` and NUL bytes is blocked.

## Output safety

Tools use output caps and return truncation metadata where relevant. Secret-like values are redacted. Private key material detected in content is refused.

`nova_search_text` treats patterns as literal text unless callers pass `regex: true`. Regex mode enforces a 300-character pattern limit and rejects common nested-quantifier patterns that can cause catastrophic backtracking.

Errors are returned as MCP tool errors with safe messages; stack traces and configured allowed-root path lists are not exposed.

## Mutating capabilities

`nova_bash` and `nova_write_file` are intentionally absent by default. State tools are not implemented in V1. Default MCP server startup is read-only and does not create project files or directories. Any future mutating/state capability must be explicitly env-gated and documented before registration.

`nova://mcp/gated-tools-policy` exposes the current roadmap and gate requirements as safe metadata only. It confirms that mutating/state tools are not registered, actions are not implemented in this slice, and future activation would require per-family environment gates, dry-run previews, human approval semantics, redacted audit logs, denylist/allowed-root enforcement, output caps, and dedicated smoke/Inspector/eval coverage.

## Optional transport readiness

`nova://mcp/transport-readiness` exposes the current transport posture as safe metadata only. The active transport is stdio; HTTP and streamable HTTP are not implemented/enabled, no listener is created, no port is opened, and public bind is not allowed by default.

Any future network transport must be explicit opt-in, localhost-only by default, authenticated before non-local or browser-accessible deployment, origin-restricted, rate-limited, and covered by targeted smoke/Inspector/eval/security review. A future transport must not weaken allowed-root, denylist, redaction, output-cap, resource, prompt, or tool-registration rules.
