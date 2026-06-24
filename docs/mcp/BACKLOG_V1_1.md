# MCP Backlog V1.1

Nova MCP V1 is complete as a local, read-only stdio server. V1.1 keeps that posture as the safe default while preparing optional transports, stronger automated validation, richer curated resources, and explicitly gated mutating capabilities.

> Implementation note (2026-06-24): the first V1.1 implementation slice delivers reinforced curated metadata/resources and eval/smoke coverage while intentionally leaving HTTP/streamable transport and mutating/state tools unimplemented by default.

## Goals

- Keep the default MCP server local, stdio-based, read-only, and safe for repository orientation.
- Add documented paths for optional secure HTTP/streamable transport without enabling remote exposure by default.
- Expand verification so safety properties are covered by smoke checks, MCP Inspector automation, and eval scenarios.
- Prepare packaging and client setup so MCP consumers can configure Nova predictably.

## Workstreams

### 1. Optional secure HTTP / streamable transport

V1.1 may add an opt-in HTTP or streamable transport alongside stdio. Requirements before implementation:

- Disabled by default; stdio remains the default transport.
- Localhost-only bind by default (`127.0.0.1` or equivalent), never `0.0.0.0` unless an explicit environment flag is set.
- Authentication required before any non-local bind or browser-accessible deployment.
- Rate limiting for requests, sessions, and expensive tool/resource operations.
- Strict origin policy for browser-based clients, with explicit allowlist configuration.
- Clear docs for threat model, config examples, and safe failure modes.
- No transport change may weaken allowed-root, denylist, redaction, output-cap, or tool-registration rules.

### 2. Automated MCP Inspector tests

Add repeatable MCP Inspector validation so manual Inspector checks become CI-friendly:

- Scripted command that starts the stdio server and validates tool/resource/prompt listing.
- Inspector scenario covering representative calls for safe reads, denied paths, resources, and prompts.
- Output summarized as pass/fail metadata only; no raw `.nova` traces, eval reports, secrets, or file contents in generated artifacts.
- Runbook instructions for local usage and future CI invocation.

### 3. Reinforced MCP evals

Expand MCP eval coverage beyond the V1 smoke/eval baseline:

- Denylist precedence for `.env`, `.env.*`, `.git`, `node_modules`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, private-key extensions, and secret-like filenames.
- Path traversal and NUL-byte refusal.
- Outside-root requests denied without disclosing configured allowed-root path lists.
- Private-key content refusal.
- Synthetic secret redaction for file reads, document reads, trace summaries, and search output.
- Output caps and truncation metadata for file, search, git, doc, trace, and web-search surfaces.
- Tool absence checks for disabled mutating tools.
- Resources/prompts checks to ensure only curated, safe entries are exposed.

### 4. Gated tools roadmap

Potential V1.1+ mutating/state tools remain disabled unless every gate below is satisfied:

- Candidate tools: `nova_write_file`, `nova_bash`, `nova_todo_*`, `nova_goal_*`, `nova_skill_*`.
- Each family needs an explicit environment flag before registration.
- Dry-run mode must be available for write and shell actions before execution.
- Approval semantics must be documented, including what requires human approval and how denial is handled.
- Audit logs must record intent, target, parameters summary, result summary, and timestamp without secrets or raw sensitive content.
- `nova_bash` must define command allow/deny policy, working-directory constraints, timeout/output caps, and destructive-command handling.
- `nova_write_file` must define allowed extensions/roots, backup/atomic-write behavior, diff preview, and refusal for denied paths.
- State tools must define storage location, schema, export/redaction behavior, and cleanup policy.

### 5. Richer curated resources

Add more `nova://` resources without exposing a raw filesystem mirror:

- Safe project status summary.
- Tool schemas and tool metadata.
- Sanitized eval/trace/report summaries only.
- Docs index for MCP docs and high-value project docs.
- Resource schema/policy metadata for consumers.
- Explicitly no raw `.nova` artifacts, raw traces, raw eval reports, `.env`, private keys, or generated sensitive artifacts.

### 6. Packaging and distribution

Prepare MCP usage outside a checked-out dev shell:

- Package `bin` entrypoint for MCP server startup, separate from the interactive Nova CLI if needed.
- Client config examples for common stdio MCP clients, with Windows path examples and portable npm/npx examples.
- Versioning policy for MCP behavior changes, especially tool/schema/resource changes.
- Release checklist covering typecheck, smoke, evals, Inspector automation, docs update, package metadata, and security review.
- Document compatibility expectations for MCP SDK and Node versions.

## Acceptance criteria for V1.1

- V1 read-only stdio behavior remains intact and remains the default.
- Backlog items implemented in V1.1 are covered by docs and targeted tests.
- Optional HTTP/streamable transport, if implemented, is off by default, localhost-only by default, authenticated when exposed, rate-limited, and origin-restricted.
- MCP Inspector automation can be run locally with a single documented command.
- Reinforced MCP evals cover denylist, traversal, outside-root, private-key, synthetic secret redaction, output caps, tool absence, resources, and prompts.
- Any mutating/state tool remains absent unless explicit environment gates, dry-run/approval semantics, and audit logging are implemented and documented.
- Curated resources expose safe summaries and metadata only; no raw `.nova` artifacts or sensitive files are reachable.
- Packaging docs include entrypoint guidance, client config examples, versioning notes, and a release checklist.

## Explicit non-goals

- No LSP implementation.
- No auto-rewrite feature.
- No default network-exposed MCP server.
- No remote deployment guidance that bypasses authentication, rate limits, or origin policy.
- No raw `.nova` trace/eval/report resource exposure.
- No default registration of `nova_bash`, `nova_write_file`, or state tools.
- No relaxation of allowed-root, denylist, redaction, or output-cap rules.
