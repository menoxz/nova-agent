# MCP Client Setup

## MCP Inspector

From the repository root:

```bash
cd C:\jeanluc\nova-agent
npx @modelcontextprotocol/inspector npm run mcp:stdio
```

Alternative direct command:

```bash
npx @modelcontextprotocol/inspector npx tsx src/mcp/server.ts
```

## Generic MCP client config

Use stdio transport with:

```json
{
  "mcpServers": {
    "nova-agent": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "C:\\jeanluc\\nova-agent"
    }
  }
}
```

## Smoke check

```bash
npm run mcp:smoke
```

The smoke check starts the server through stdio, lists tools/resources/prompts, confirms `nova_bash` and `nova_write_file` are absent, verifies path traversal/outside-root/denylist protections, checks synthetic secret redaction/refusal, verifies truncation metadata, and confirms safe reads/searches still work.

## Inspector-style automated validation

```bash
npm run mcp:inspect
```

This CI-friendly validation starts the local stdio server with a synthetic temporary allowed root and exercises the same MCP surfaces an operator would inspect manually: tool/resource/prompt listing, `nova_mcp_capabilities`, curated V1.1 resources, prompt retrieval, safe reads, representative denied reads, redaction, literal search defaults, regex opt-in, and regex guardrails.

The command prints pass/fail metadata only. It does not write reports, expose raw `.nova` artifacts, print configured root paths, or enable HTTP/network transport.
