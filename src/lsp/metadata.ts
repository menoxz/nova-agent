import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { defaultScenarios } from '../eval/scenarios.js';
import { listSuites } from '../eval/suites.js';
import { capText, containsPrivateKeyMaterial, PROJECT_ROOT, deniedReason, readSafeTextFile, redactText, resolvePolicyPath, safeRelative } from './policy.js';

export type MetadataKind = 'script' | 'tool' | 'resource' | 'prompt' | 'doc' | 'eval' | 'policy' | 'command';

export type NovaMetadataItem = {
  id: string;
  label: string;
  kind: MetadataKind;
  detail: string;
  documentation?: string;
  path?: string;
  tags?: string[];
  readOnly: boolean;
};

export type NovaMetadataIndex = {
  items: NovaMetadataItem[];
  byId: Map<string, NovaMetadataItem>;
  generatedAt: string;
  packageScripts: string[];
  evalSuites: string[];
};

export const LSP_COMMANDS = [
  'nova.lsp.showToolMetadata',
  'nova.lsp.showRelatedDocs',
  'nova.lsp.explainPolicy',
  'nova.lsp.showEvalScenario',
  'nova.lsp.showSetupGuide',
  'nova.lsp.showTelemetrySummary',
] as const;

export const EXPECTED_SCRIPTS = ['lsp:stdio', 'lsp:smoke', 'eval:lsp', 'mcp:stdio', 'mcp:smoke', 'eval:mcp', 'eval:smoke', 'eval:core', 'typecheck'] as const;

const BUILTIN_TOOLS: NovaMetadataItem[] = [
  { id: 'tool:read_file', label: 'read_file', kind: 'tool', detail: 'Read local files for the agent runtime.', documentation: 'Agent tool; not an LSP write command.', readOnly: true },
  { id: 'tool:write_file', label: 'write_file', kind: 'tool', detail: 'Agent runtime write tool; intentionally not exposed through LSP V1.', readOnly: false },
  { id: 'tool:bash', label: 'bash', kind: 'tool', detail: 'Agent runtime shell tool; intentionally not exposed through LSP V1.', readOnly: false },
  { id: 'tool:glob', label: 'glob', kind: 'tool', detail: 'Find files by pattern.', readOnly: true },
  { id: 'tool:grep', label: 'grep', kind: 'tool', detail: 'Search text by pattern.', readOnly: true },
  { id: 'tool:list_directory', label: 'list_directory', kind: 'tool', detail: 'List directories.', readOnly: true },
  { id: 'tool:get_file_info', label: 'get_file_info', kind: 'tool', detail: 'Return file metadata.', readOnly: true },
  { id: 'tool:git', label: 'git', kind: 'tool', detail: 'Agent git helper; use read-only operations unless explicitly authorized.', readOnly: true },
  { id: 'tool:web_search', label: 'web_search', kind: 'tool', detail: 'Bounded web search helper.', readOnly: true },
  { id: 'tool:nova_tool_catalog', label: 'nova_tool_catalog', kind: 'tool', detail: 'MCP V1 read-only tool catalog.', readOnly: true },
  { id: 'tool:nova_read_file', label: 'nova_read_file', kind: 'tool', detail: 'MCP V1 policy-approved file reader.', readOnly: true },
  { id: 'tool:nova_search_text', label: 'nova_search_text', kind: 'tool', detail: 'MCP V1 safe text search; literal by default.', readOnly: true },
  { id: 'tool:nova_trace_summarize', label: 'nova_trace_summarize', kind: 'tool', detail: 'MCP V1 sanitized aggregate trace summary only.', readOnly: true },
];

const RESOURCE_ITEMS: NovaMetadataItem[] = [
  { id: 'resource:nova://docs/status', label: 'nova://docs/status', kind: 'resource', detail: 'Curated project status resource.', readOnly: true },
  { id: 'resource:nova://docs/mcp/readme', label: 'nova://docs/mcp/readme', kind: 'resource', detail: 'MCP V1 README resource.', readOnly: true },
  { id: 'resource:nova://eval/scenarios', label: 'nova://eval/scenarios', kind: 'resource', detail: 'Eval scenario IDs and tags only; raw reports denied.', readOnly: true },
];

const PROMPT_ITEMS: NovaMetadataItem[] = [
  { id: 'prompt:nova_repository_orientation', label: 'nova_repository_orientation', kind: 'prompt', detail: 'Read-only repository orientation prompt.', readOnly: true },
  { id: 'prompt:nova_readonly_review', label: 'nova_readonly_review', kind: 'prompt', detail: 'Review without modifying files.', readOnly: true },
  { id: 'prompt:nova_tool_safety_review', label: 'nova_tool_safety_review', kind: 'prompt', detail: 'Review tool safety posture.', readOnly: true },
  { id: 'prompt:nova_eval_scenario_design', label: 'nova_eval_scenario_design', kind: 'prompt', detail: 'Design deterministic read-only eval scenarios.', readOnly: true },
];

function quotedLiteral(value: string): string {
  return value.replace(/\\`/g, '`').replace(/\\'/g, "'");
}

async function readSafeSourceMetadata(path: string): Promise<string | undefined> {
  const check = resolvePolicyPath(path, 'source metadata path');
  if (!check.ok) return undefined;
  const raw = await readFile(check.path).catch(() => undefined);
  if (!raw || raw.includes(0)) return undefined;
  const text = raw.toString('utf-8');
  if (containsPrivateKeyMaterial(text)) return undefined;
  return capText(redactText(text), 80_000).text;
}

async function loadMcpSourceMetadata(): Promise<NovaMetadataItem[]> {
  const text = await readSafeSourceMetadata('src/mcp/server.ts');
  if (!text) return [];
  const items: NovaMetadataItem[] = [];

  const toolPattern = /\{\s*name:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*,\s*defaultEnabled:\s*(true|false)\s*,\s*readOnly:\s*(true|false)\s*,\s*category:\s*'([^']+)'\s*,\s*description:\s*'([^']*)'\s*\}/g;
  for (const match of text.matchAll(toolPattern)) {
    const [, name, title, defaultEnabled, readOnly, category, description] = match;
    items.push({
      id: `mcp-tool:${name}`,
      label: name,
      kind: 'tool',
      detail: `MCP source registration: ${quotedLiteral(title)} (${category}, ${defaultEnabled === 'true' ? 'enabled' : 'disabled/absent'} by default).`,
      documentation: quotedLiteral(description),
      path: 'src/mcp/server.ts',
      tags: ['mcp', 'source-derived', category],
      readOnly: readOnly === 'true',
    });
  }

  const resourcePattern = /\{\s*name:\s*'([^']+)'\s*,\s*uri:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*,\s*description:\s*'([^']*)'\s*,\s*contentKind:\s*'([^']+)'\s*\}/g;
  for (const match of text.matchAll(resourcePattern)) {
    const [, name, uri, title, description, contentKind] = match;
    items.push({
      id: `mcp-resource:${uri}`,
      label: uri,
      kind: 'resource',
      detail: `MCP source resource: ${quotedLiteral(title)} (${contentKind}).`,
      documentation: quotedLiteral(description),
      path: 'src/mcp/server.ts',
      tags: ['mcp', 'source-derived', contentKind, name],
      readOnly: true,
    });
  }

  const promptPattern = /server\.registerPrompt\('([^']+)'\s*,\s*\{\s*title:\s*'([^']+)'\s*,\s*description:\s*'([^']+)'/g;
  for (const match of text.matchAll(promptPattern)) {
    const [, name, title, description] = match;
    items.push({
      id: `mcp-prompt:${name}`,
      label: name,
      kind: 'prompt',
      detail: `MCP source prompt: ${quotedLiteral(title)}.`,
      documentation: quotedLiteral(description),
      path: 'src/mcp/server.ts',
      tags: ['mcp', 'source-derived'],
      readOnly: true,
    });
  }

  return items;
}

const POLICY_ITEMS: NovaMetadataItem[] = [
  { id: 'policy:lsp-readonly', label: 'Nova LSP V1 read-only policy', kind: 'policy', detail: 'LSP V1 exposes hover/completion/symbol metadata and read-only commands only.', documentation: 'No WorkspaceEdit, no shell execution, no file writes, and no autonomous self-rewrite.', readOnly: true },
  { id: 'policy:denylist', label: 'Nova LSP denylist', kind: 'policy', detail: 'Denies .env, .git, node_modules, raw .nova traces/evals/reports, private keys, and secret-like paths/content.', readOnly: true },
  { id: 'policy:lsp-v1-1-client-setup', label: 'Nova LSP V1.1 client setup policy', kind: 'policy', detail: 'Client setup guidance is metadata-only and keeps stdio, read-only commands, and no WorkspaceEdit as defaults.', documentation: 'VS Code and Neovim examples must start npm run lsp:stdio or node dist/lsp/server.js over stdio only; they must not grant shell/write commands.', readOnly: true },
  { id: 'policy:lsp-v1-1-telemetry-summary', label: 'Nova LSP V1.1 telemetry summary policy', kind: 'policy', detail: 'Telemetry summaries are aggregate metadata only and omit document content, raw diagnostics, URIs, root paths, and secrets.', documentation: 'Use nova.lsp.showTelemetrySummary for safe counts and policy posture; do not expose open-document text or raw sensitive artifacts.', readOnly: true },
];

async function loadPackageScripts(): Promise<NovaMetadataItem[]> {
  const text = await readSafeTextFile('package.json');
  if (!text) return [];
  const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
  return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({
    id: `script:${name}`,
    label: `npm run ${name}`,
    kind: 'script' as const,
    detail: command,
    documentation: `Package script \`${name}\` from package.json.`,
    path: 'package.json',
    readOnly: !/(write|bash|shell|commit|push|publish|deploy)/i.test(name),
  }));
}

async function loadDocs(): Promise<NovaMetadataItem[]> {
  const docsRoot = join(PROJECT_ROOT, 'docs');
  const items: NovaMetadataItem[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (deniedReason(full)) continue;
      if (entry.isDirectory()) await walk(full, depth + 1);
      if (entry.isFile() && ['.md', '.txt'].includes(extname(entry.name).toLowerCase())) {
        const info = await stat(full).catch(() => undefined);
        if (!info?.isFile()) continue;
        const rel = safeRelative(full).replace(/\\/g, '/');
        const safeText = await readSafeTextFile(full);
        if (!safeText) continue;
        const firstLine = safeText.split(/\r?\n/).find((line) => line.trim()) ?? rel;
        items.push({ id: `doc:${rel}`, label: rel, kind: 'doc', detail: firstLine.replace(/^#+\s*/, '').slice(0, 160), path: rel, readOnly: true });
      }
    }
  }
  await walk(docsRoot, 0);
  return items;
}

function evalItems(): NovaMetadataItem[] {
  const scenarios = defaultScenarios.map((scenario) => ({
    id: `eval:${scenario.id}`,
    label: scenario.id,
    kind: 'eval' as const,
    detail: scenario.name,
    documentation: scenario.description,
    tags: scenario.tags,
    path: 'src/eval/scenarios.ts',
    readOnly: true,
  }));
  const suites = listSuites().map((suite) => ({
    id: `eval-suite:${suite.name}`,
    label: `eval suite ${suite.name}`,
    kind: 'eval' as const,
    detail: suite.scenarioIds.join(', '),
    path: 'src/eval/suites.ts',
    readOnly: true,
  }));
  return [...scenarios, ...suites];
}

export async function buildMetadataIndex(): Promise<NovaMetadataIndex> {
  const scripts = await loadPackageScripts();
  const docs = await loadDocs();
  const sourceDerivedMcp = await loadMcpSourceMetadata();
  const commands = LSP_COMMANDS.map((command) => ({ id: `command:${command}`, label: command, kind: 'command' as const, detail: 'LSP V1 read-only executeCommand provider command.', readOnly: true }));
  const items = [...scripts, ...BUILTIN_TOOLS, ...RESOURCE_ITEMS, ...PROMPT_ITEMS, ...sourceDerivedMcp, ...docs, ...evalItems(), ...POLICY_ITEMS, ...commands];
  const byId = new Map(items.map((item) => [item.id, item]));
  return { items, byId, generatedAt: new Date().toISOString(), packageScripts: scripts.map((script) => script.id.slice('script:'.length)), evalSuites: listSuites().map((suite) => suite.name) };
}

export function findMetadataAtText(text: string, index: NovaMetadataIndex): NovaMetadataItem | undefined {
  return index.items
    .filter((item) => text.includes(item.label) || text.includes(item.id.replace(/^[^:]+:/, '')))
    .sort((a, b) => b.label.length - a.label.length)[0];
}

export function formatMetadataItem(item: NovaMetadataItem): string {
  return [
    `**${item.label}** (${item.kind})`,
    item.detail,
    item.documentation,
    item.path ? `Path: \`${item.path}\`` : undefined,
    `Read-only: ${item.readOnly ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n\n');
}
