# `web_search`

`web_search` performs bounded web search and returns exploitable results with title, URL, snippet, source, and provider.

It is designed for agent use: no API key, explicit timeout, output limits, validation, user-agent, provider fallback, and deduplication.

## Providers

Default provider chain:

1. `duckduckgo-html` — `https://html.duckduckgo.com/html/`
2. `duckduckgo-lite` — `https://lite.duckduckgo.com/lite/`

If the first provider fails or returns no parseable results, the tool tries the next provider. If all providers fail, the response contains provider notes/errors and a clear no-results message.

## User-Agent

Every request uses an explicit user-agent:

```text
NovaAgent/0.1 (+https://example.local; bounded web_search tool)
```

## Inputs

```ts
{
  query: string;          // 2-500 chars; must contain letters or numbers
  maxResults?: number;   // default 5, max 20
  timeout?: number;      // per-provider timeout, default 10000 ms, max 30000 ms
  maxChars?: number;     // output cap, default 12000, max 50000
  format?: "text" | "json"; // default text
}
```

## Text output

```json
{
  "query": "Nova Agent Microsoft GitHub",
  "maxResults": 3
}
```

Returns:

```text
## Web Search
Query: Nova Agent Microsoft GitHub
Provider: duckduckgo-html
Results: 3
Elapsed: 1116 ms
User-Agent: NovaAgent/0.1 (+https://example.local; bounded web_search tool)

### 1. GitHub - microsoft/nova-agent: NOVA: An agentic framework for automated ...
URL: https://github.com/microsoft/nova-agent
Source: github.com (via duckduckgo-html)
Snippet: NOVA is a modular agentic framework...
```

## JSON output

```json
{
  "query": "Nova Agent Microsoft GitHub",
  "maxResults": 2,
  "format": "json"
}
```

Returns:

```json
{
  "query": "Nova Agent Microsoft GitHub",
  "provider": "duckduckgo-html",
  "elapsedMs": 707,
  "userAgent": "NovaAgent/0.1 (+https://example.local; bounded web_search tool)",
  "errors": [],
  "results": [
    {
      "title": "GitHub - microsoft/nova-agent: NOVA: An agentic framework for automated ...",
      "url": "https://github.com/microsoft/nova-agent",
      "snippet": "NOVA is a modular agentic framework...",
      "source": "github.com",
      "provider": "duckduckgo-html"
    }
  ]
}
```

## Reliability / safety behavior

- Uses `AbortController` timeout per provider.
- Fetches only search result pages; it does not open result URLs.
- Caps fetched HTML to 1.5 MB before parsing.
- Caps final output via `maxChars`.
- Deduplicates results by normalized URL.
- Decodes DuckDuckGo redirect URLs (`/l/?uddg=...`).
- Removes URL hash fragments.
- Validates query length and rejects punctuation-only queries.

## Limits

- DuckDuckGo HTML markup can change; parser is best-effort.
- Search provider rate limits or anti-bot pages may produce no parseable results.
- Snippets depend on provider output and may be empty.
- The tool does not fetch or summarize destination pages; use a future/read tool for that.

## Verification performed

- `npx tsc --noEmit`
- Real query: `Nova Agent Microsoft GitHub`
  - returned deduplicated results with title, URL, snippet, source, provider
- JSON mode produced parseable structured output
- invalid query `!` returned a clear validation error
- final audit: `npm audit --omit=dev --json` → 0 vulnerabilities
