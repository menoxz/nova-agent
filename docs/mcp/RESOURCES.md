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

Observability resources expose counters, statuses, run IDs, timestamps, gates, failure names/checks, and aggregate metrics. They intentionally omit raw `.nova` eval/trace/report contents, raw trace events, report file paths, configured root paths, and secret-like strings.
