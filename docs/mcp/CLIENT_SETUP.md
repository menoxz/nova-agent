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
