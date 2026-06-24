# MCP Backlog V1.1

Nova MCP V1 is complete as a local, read-only stdio server. V1.1 keeps that posture as the safe default while preparing optional transports, stronger automated validation, richer curated resources, and explicitly gated mutating capabilities.

> Implementation note (2026-06-24): the first V1.1 implementation slice delivers reinforced curated metadata/resources and eval/smoke coverage while intentionally leaving HTTP/streamable transport and mutating/state tools unimplemented by default. Follow-up slices add `npm run mcp:inspect` for repeatable Inspector-style stdio validation and `nova-mcp` as a dedicated packaged stdio entrypoint.

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

Status: metadata/readiness policy implemented by `nova://mcp/transport-readiness`. The resource documents current stdio-only posture, confirms HTTP/streamable HTTP are not implemented or enabled, confirms no listener/port/bind is created, and records requirements for any future opt-in network transport.

### 2. Automated MCP Inspector tests

Add repeatable MCP Inspector validation so manual Inspector checks become CI-friendly:

- Scripted command that starts the stdio server and validates tool/resource/prompt listing.
- Inspector scenario covering representative calls for safe reads, denied paths, resources, and prompts.
- Output summarized as pass/fail metadata only; no raw `.nova` traces, eval reports, secrets, or file contents in generated artifacts.
- Runbook instructions for local usage and future CI invocation.

Status: first local automation slice implemented by `npm run mcp:inspect`; it starts the stdio server, validates listing/calls/resources/prompts with synthetic fixtures, and prints pass/fail metadata only.

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

Status: implemented by the `eval:mcp` mock suite. Coverage now includes the baseline read-only denylist, V1.1 curated metadata/resources, path denial matrix (`.env.*`, `.git`, `node_modules`, raw `.nova/*`, traversal, NUL, outside-root, private keys), redaction/output caps, disabled mutating/state tools, and curated resources/prompts.

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

Status: metadata/roadmap implemented by `nova://mcp/gated-tools-policy`. The resource documents candidate families, per-family environment gates, dry-run/approval/audit requirements, and non-goals while confirming `nova_bash`, `nova_write_file`, and state tools remain absent and no mutating/state action is implemented.

### 5. Richer curated resources

Add more `nova://` resources without exposing a raw filesystem mirror:

- Safe project status summary.
- Tool schemas and tool metadata.
- Sanitized eval/trace/report summaries only.
- Docs index for MCP docs and high-value project docs.
- Resource schema/policy metadata for consumers.
- Explicitly no raw `.nova` artifacts, raw traces, raw eval reports, `.env`, private keys, or generated sensitive artifacts.

Status: implemented. Curated metadata resources include the resource schema/version policy at `nova://resources/schema-policy`, with `resourceSchemaVersion: 1`, `resourcePolicyVersion: 1`, URI stability rules, behavior/schema/policy bump rules, and an inventory of all curated resources. Sanitized observability resources are implemented for eval recent/latest summaries, reports latest summary, trace summary, and combined observability summary. They expose summary metadata only and omit raw `.nova` contents, raw events, report paths, configured roots, and secrets.

### 6. Packaging and distribution

Prepare MCP usage outside a checked-out dev shell:

- Package `bin` entrypoint for MCP server startup, separate from the interactive Nova CLI if needed.
- Client config examples for common stdio MCP clients, with Windows path examples and portable npm/npx examples.
- Versioning policy for MCP behavior changes, especially tool/schema/resource changes.
- Release checklist covering typecheck, smoke, evals, Inspector automation, docs update, package metadata, and security review.
- Document compatibility expectations for MCP SDK and Node versions.

Status: implemented for the safe local/stdio packaging track. The first packaging/client setup slice delivered `nova-mcp`, `npm run mcp:bin-smoke`, packaged MCP docs, and client config examples for checkout, linked/global install, npm exec, and Windows path usage. The release-readiness/compatibility slice adds generated resources `nova://mcp/release-checklist` and `nova://mcp/compatibility`, strengthens `npm run release:readiness` so the package manifest must include the MCP bin and MCP docs, and documents Node.js 22 / `@modelcontextprotocol/sdk` expectations. Resource/schema versioning policy is implemented in the richer curated resources slice.

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
