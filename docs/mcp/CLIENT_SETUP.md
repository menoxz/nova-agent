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

Packaged/stdout-safe stdio entrypoint after build or install:

```bash
npm run build
node bin/nova-mcp.js
```

With a linked or globally installed package:

```bash
nova-mcp
```

`nova-mcp` is dedicated to the MCP stdio server. It does not start the interactive Nova CLI, does not enable HTTP/streamable transport, and rejects extra CLI arguments other than `--help`/`--version`.

## Generic MCP client config

Use stdio transport from a repository checkout with:

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

For an installed or linked package, prefer the dedicated bin:

```json
{
  "mcpServers": {
    "nova-agent": {
      "command": "nova-mcp",
      "args": []
    }
  }
}
```

For clients that should resolve the package at launch time without a global install:

```json
{
  "mcpServers": {
    "nova-agent": {
      "command": "npm",
      "args": ["exec", "--yes", "--package", "@lux-tech/nova-agent", "--", "nova-mcp"]
    }
  }
}
```

Windows clients that require an explicit local path can use:

```json
{
  "mcpServers": {
    "nova-agent": {
      "command": "node",
      "args": ["C:\\jeanluc\\nova-agent\\bin\\nova-mcp.js"]
    }
  }
}
```

## Smoke check

```bash
npm run mcp:smoke
npm run mcp:bin-smoke
```

The smoke check starts the server through stdio, lists tools/resources/prompts, confirms `nova_bash` and `nova_write_file` are absent, verifies path traversal/outside-root/denylist protections, checks synthetic secret redaction/refusal, verifies truncation metadata, and confirms safe reads/searches still work.

`mcp:bin-smoke` verifies the dedicated packaged entrypoint metadata paths, the built stdio handshake, and linked-package `nova-mcp --help` / `--version` behaviour.

## Inspector-style automated validation

```bash
npm run mcp:inspect
```

This CI-friendly validation starts the local stdio server with a synthetic temporary allowed root and exercises the same MCP surfaces an operator would inspect manually: tool/resource/prompt listing, `nova_mcp_capabilities`, curated V1.1 resources, transport readiness policy, gated tools policy, resource schema/version policy, release readiness and compatibility metadata, prompt retrieval, safe reads, representative denied reads, redaction, literal search defaults, regex opt-in, and regex guardrails.

The command prints pass/fail metadata only. It does not write reports, expose raw `.nova` artifacts, print configured root paths, or enable HTTP/network transport.

## Release readiness and compatibility metadata

MCP clients can read `nova://mcp/release-checklist` and `nova://mcp/compatibility` for packaging expectations before configuring an installed package. These resources are generated metadata only: they list local validation commands, package manifest safety checks, Node.js 22 / `@modelcontextprotocol/sdk` compatibility expectations, stdio entrypoints, and explicit no-publish/no-tag/no-release non-goals.
