/**
 * Nova Agent — Tool: web_search
 *
 * Bounded web search with explicit timeout, output limits, user-agent,
 * provider fallback, deduplication, and structured result fields.
 *
 * Default providers use DuckDuckGo's HTML/Lite pages (no API key required).
 * This tool fetches search result pages only; it does not browse result URLs.
 */

import { z } from 'zod';
import type { NovaTool } from '../../types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 20;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 50_000;
const MAX_HTML_CHARS = 1_500_000;
const USER_AGENT = 'NovaAgent/0.1 (+https://example.local; bounded web_search tool)';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
};

type Provider = {
  name: string;
  url: (query: string) => string;
  parse: (html: string) => SearchResult[];
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

function validateQuery(query: unknown): string {
  if (typeof query !== 'string') throw new Error('query must be a string.');
  const q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 2) throw new Error('query must contain at least 2 non-whitespace characters.');
  if (q.length > 500) throw new Error('query is too long (max 500 characters).');
  if (/^[\p{P}\p{S}\s]+$/u.test(q)) throw new Error('query must contain letters or numbers, not only punctuation/symbols.');
  return q;
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripTags(html: string): string {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}=(['\"])([\\s\\S]*?)\\1`, 'i');
  const m = tag.match(re);
  return m ? decodeHtml(m[2]) : undefined;
}

function sourceFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function normalizeResultUrl(raw: string): string | undefined {
  let url = decodeHtml(raw).trim();
  if (!url) return undefined;
  if (url.startsWith('//')) url = `https:${url}`;

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) url = decodeURIComponent(uddg);
    }
  } catch {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function dedupe(results: SearchResult[], limit: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    const normalizedUrl = normalizeResultUrl(result.url);
    if (!normalizedUrl) continue;
    const key = normalizedUrl.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...result,
      url: normalizedUrl,
      title: result.title.slice(0, 240),
      snippet: result.snippet.slice(0, 500),
      source: sourceFromUrl(normalizedUrl),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function findResultAnchors(html: string, className: string): Array<{ start: number; end: number; tag: string; inner: string }> {
  const anchors: Array<{ start: number; end: number; tag: string; inner: string }> = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = `<a${m[1]}>`;
    const cls = attr(tag, 'class') || '';
    if (cls.split(/\s+/).includes(className)) {
      anchors.push({ start: m.index, end: re.lastIndex, tag, inner: m[2] });
    }
  }
  return anchors;
}

function snippetFromBlock(block: string): string {
  const snippets = [
    /<(?:a|div)\b[^>]*class=(['"])[^'"]*result__snippet[^'"]*\1[^>]*>([\s\S]*?)<\/(?:a|div)>/i,
    /<td\b[^>]*class=(['"])[^'"]*result-snippet[^'"]*\1[^>]*>([\s\S]*?)<\/td>/i,
  ];
  for (const re of snippets) {
    const m = block.match(re);
    if (m) return stripTags(m[2]);
  }
  return '';
}

function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const anchors = findResultAnchors(html, 'result__a');
  const results: SearchResult[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const href = attr(a.tag, 'href');
    const url = href ? normalizeResultUrl(href) : undefined;
    const title = stripTags(a.inner);
    if (!url || !title) continue;
    const nextStart = anchors[i + 1]?.start ?? Math.min(html.length, a.end + 5000);
    const block = html.slice(a.end, nextStart);
    results.push({ title, url, snippet: snippetFromBlock(block), source: sourceFromUrl(url), provider: 'duckduckgo-html' });
  }
  return results;
}

function parseDuckDuckGoLite(html: string): SearchResult[] {
  const anchors = findResultAnchors(html, 'result-link');
  const results: SearchResult[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const href = attr(a.tag, 'href');
    const url = href ? normalizeResultUrl(href) : undefined;
    const title = stripTags(a.inner);
    if (!url || !title) continue;
    const nextStart = anchors[i + 1]?.start ?? Math.min(html.length, a.end + 5000);
    const block = html.slice(a.end, nextStart);
    results.push({ title, url, snippet: snippetFromBlock(block), source: sourceFromUrl(url), provider: 'duckduckgo-lite' });
  }
  return results;
}

const providers: Provider[] = [
  {
    name: 'duckduckgo-html',
    url: query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoHtml,
  },
  {
    name: 'duckduckgo-lite',
    url: query => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoLite,
  },
];

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const text = await response.text();
    return text.length > MAX_HTML_CHARS ? text.slice(0, MAX_HTML_CHARS) : text;
  } finally {
    clearTimeout(timer);
  }
}

async function searchProviders(query: string, timeoutMs: number, maxResults: number): Promise<{ provider: string; results: SearchResult[]; errors: string[]; elapsedMs: number }> {
  const started = Date.now();
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      const html = await fetchText(provider.url(query), timeoutMs);
      const parsed = dedupe(provider.parse(html), maxResults);
      if (parsed.length > 0) {
        return { provider: provider.name, results: parsed, errors, elapsedMs: Date.now() - started };
      }
      errors.push(`${provider.name}: no parseable results`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${msg}`);
    }
  }
  return { provider: 'none', results: [], errors, elapsedMs: Date.now() - started };
}

function formatText(query: string, provider: string, results: SearchResult[], errors: string[], elapsedMs: number): string {
  const lines = [`## Web Search`, `Query: ${query}`, `Provider: ${provider}`, `Results: ${results.length}`, `Elapsed: ${elapsedMs} ms`, `User-Agent: ${USER_AGENT}`, ''];
  if (errors.length > 0) {
    lines.push('### Provider notes');
    for (const error of errors) lines.push(`- ${error}`);
    lines.push('');
  }
  if (results.length === 0) {
    lines.push('No results. All providers failed or returned no parseable results.');
    return lines.join('\n');
  }
  for (const [idx, result] of results.entries()) {
    lines.push(`### ${idx + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    lines.push(`Source: ${result.source} (via ${result.provider})`);
    lines.push(`Snippet: ${result.snippet || '(none)'}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export const webSearchTool: NovaTool = {
  name: 'web_search',
  description: 'Search the web with bounded timeout/output, explicit user-agent, provider fallback, input validation, deduplication, and structured results containing title, URL, snippet, source, and provider.',
  inputSchema: z.object({
    query: z.string().describe('Search query. 2-500 chars; must contain letters or numbers.'),
    maxResults: z.number().int().min(1).max(MAX_RESULTS).optional().describe(`Max deduplicated results to return (default: ${DEFAULT_MAX_RESULTS}, max: ${MAX_RESULTS}).`),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe(`Timeout per provider in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS}).`),
    maxChars: z.number().int().min(1000).max(MAX_OUTPUT_CHARS).optional().describe(`Max output chars (default: ${DEFAULT_MAX_CHARS}, max: ${MAX_OUTPUT_CHARS}).`),
    format: z.enum(['text', 'json']).optional().describe('Output format. Default: text.'),
  }),
  execute: async ({ query, maxResults, timeout, maxChars, format }) => {
    try {
      const q = validateQuery(query);
      const limit = clampNumber(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
      const timeoutMs = clampNumber(timeout, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
      const outputLimit = clampNumber(maxChars, DEFAULT_MAX_CHARS, 1000, MAX_OUTPUT_CHARS);

      const search = await searchProviders(q, timeoutMs, limit);
      const payload = {
        query: q,
        provider: search.provider,
        elapsedMs: search.elapsedMs,
        userAgent: USER_AGENT,
        errors: search.errors,
        results: search.results,
      };

      let output = format === 'json'
        ? JSON.stringify(payload, null, 2)
        : formatText(q, search.provider, search.results, search.errors, search.elapsedMs);

      if (output.length > outputLimit) output = output.slice(0, outputLimit) + `\n...(web_search output truncated at ${outputLimit} chars)`;
      return output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error in web_search: ${msg}`;
    }
  },
};
