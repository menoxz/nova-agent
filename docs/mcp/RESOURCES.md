# MCP Resources

Nova MCP exposes curated resources only. It does not expose a raw filesystem mirror.

## Resource URIs

- `nova://docs/status`
- `nova://docs/mcp/readme`
- `nova://docs/mcp/tools`
- `nova://docs/mcp/security`
- `nova://docs/mcp/resources`
- `nova://docs/mcp/prompts`
- `nova://docs/mcp/client-setup`
- `nova://mcp/capabilities`
- `nova://mcp/policy`
- `nova://resources/schema-policy`
- `nova://mcp/release-checklist`
- `nova://mcp/compatibility`
- `nova://tools/schemas`
- `nova://docs/index`
- `nova://tools/catalog`
- `nova://eval/scenarios`
- `nova://eval/schema`
- `nova://eval/recent-summary`
- `nova://eval/latest-summary`
- `nova://reports/latest-summary`
- `nova://trace/summary`
- `nova://observability/summary`

Resources are documentation or generated metadata summaries. Sensitive local artifacts remain denied through file tools and are not mirrored as resources. V1.1 resources expose capability limits, policy metadata, tool schema summaries, a curated docs index, and sanitized observability summaries only.

## Schema and versioning policy

`nova://resources/schema-policy` is the stable consumer-facing contract for MCP resource schemas. It exposes:

- package version `0.1.0` as the server/package version source;
- MCP behavior version `1.1` for MCP-visible compatibility posture;
- `resourceSchemaVersion: 1` for generated resource payload shape compatibility;
- `resourcePolicyVersion: 1` for disclosure/redaction/transport/mutating-tool policy semantics;
- URI stability rules: existing `nova://` resource URIs stay stable within a behavior version unless deprecated with docs and eval coverage;
- a full inventory of curated resources with `uri`, `title`, `description`, `contentKind`, and `schemaVersion`.

Additive JSON fields keep `resourceSchemaVersion: 1`. Incompatible payload shape changes bump `resourceSchemaVersion`; safety/disclosure policy changes bump `resourcePolicyVersion`; broader MCP-visible behavior changes bump the MCP behavior version. Package version remains governed by `package.json` and is not bumped for this V1.1 metadata-only slice.

## Release readiness and compatibility

`nova://mcp/release-checklist` exposes a metadata-only checklist for MCP stdio packaging readiness. It includes the required validation commands (`typecheck`, MCP smoke/Inspector/bin smoke, `eval:mcp`, build/check, and `release:readiness`), package manifest expectations, and explicit non-goals: no npm publish, no git tag, and no GitHub release as part of this slice.

`nova://mcp/compatibility` exposes Node/MCP SDK/client expectations for MCP consumers: Node.js 22.x as the CI/runtime baseline, `@modelcontextprotocol/sdk ^1.29.0`, and `nova-mcp` stdio entrypoints. HTTP/streamable transport, remote bind, mutating tools, and state tools remain unsupported by default.

Observability resources expose counters, statuses, run IDs, timestamps, gates, failure names/checks, and aggregate metrics. They intentionally omit raw `.nova` eval/trace/report contents, raw trace events, report file paths, configured root paths, and secret-like strings.
