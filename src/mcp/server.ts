#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { defaultScenarios } from '../eval/scenarios.js';
import { latestEvalReport, listEvalReports, summarizeEvalReport } from '../eval/reporting.js';
import { EVAL_SCHEMA_VERSION } from '../eval/schema.js';
import { buildEvalSloDashboard } from '../eval/slo.js';
import { evalSuites, listSuites } from '../eval/suites.js';
import {
  PROJECT_ROOT,
  capText,
  clampOutputLimit,
  containsPrivateKeyMaterial,
  deniedPathReason,
  redactString,
  resolvePolicyPath as resolveSharedPolicyPath,
  safeRelative as sharedSafeRelative,
  splitRootsEnv,
} from '../policy/index.js';
import { readDocxTool } from '../tools/builtin/read_docx.js';
import { readExcelTool } from '../tools/builtin/read_excel.js';
import { readPdfTool } from '../tools/builtin/read_pdf.js';
import { webSearchTool } from '../tools/builtin/web_search.js';
import { TRACE_SCHEMA_VERSION } from '../trace/schema.js';
import { summarizeTraces } from '../trace/summary.js';

const VERSION = '0.1.0';
const MCP_BEHAVIOR_VERSION = '1.1';
const MCP_RESOURCE_SCHEMA_VERSION = 1;
const MCP_RESOURCE_POLICY_VERSION = 1;
const MCP_NODE_COMPATIBILITY = 'Node.js 22.x (CI baseline; current dev target)';
const MCP_SDK_COMPATIBILITY = '@modelcontextprotocol/sdk ^1.29.0';
const HARD_OUTPUT_MAX_CHARS = 120_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIR_ENTRIES = 300;
const MAX_SEARCH_FILES = 500;
const MAX_TEXT_MATCHES = 200;
const MAX_SEARCH_PATTERN_CHARS = 300;
const DENIED_MESSAGE = 'Access denied by Nova MCP read-only security policy.';

type ToolPayload = Record<string, unknown>;

type ReadableTool = {
  name: string;
  title: string;
  defaultEnabled: boolean;
  readOnly: boolean;
  category: 'catalog' | 'filesystem' | 'search' | 'git' | 'docs' | 'web' | 'eval' | 'trace' | 'disabled';
  description: string;
};

const toolCatalog: ReadableTool[] = [
  { name: 'nova_tool_catalog', title: 'Nova Tool Catalog', defaultEnabled: true, readOnly: true, category: 'catalog', description: 'List MCP tools and their safety posture.' },
  { name: 'nova_mcp_capabilities', title: 'MCP Capabilities', defaultEnabled: true, readOnly: true, category: 'catalog', description: 'Summarize server capabilities, limits, resources, prompts, and disabled mutating tools.' },
  { name: 'nova_read_file', title: 'Read File', defaultEnabled: true, readOnly: true, category: 'filesystem', description: 'Read a policy-approved text file under allowed roots with output caps and redaction.' },
  { name: 'nova_list_directory', title: 'List Directory', defaultEnabled: true, readOnly: true, category: 'filesystem', description: 'List policy-approved directory entries without exposing denied paths.' },
  { name: 'nova_search_files', title: 'Search Files', defaultEnabled: true, readOnly: true, category: 'search', description: 'Find policy-approved files by glob-like pattern under allowed roots.' },
  { name: 'nova_search_text', title: 'Search Text', defaultEnabled: true, readOnly: true, category: 'search', description: 'Search text in policy-approved files with line caps and redaction.' },
  { name: 'nova_git_status', title: 'Git Status', defaultEnabled: true, readOnly: true, category: 'git', description: 'Run bounded read-only git status.' },
  { name: 'nova_git_diff', title: 'Git Diff', defaultEnabled: true, readOnly: true, category: 'git', description: 'Run bounded read-only git diff with redaction and output caps.' },
  { name: 'nova_git_log', title: 'Git Log', defaultEnabled: true, readOnly: true, category: 'git', description: 'Run bounded read-only git log.' },
  { name: 'nova_doc_read', title: 'Document Read', defaultEnabled: true, readOnly: true, category: 'docs', description: 'Read approved PDF/DOCX/XLSX or text documentation files through existing readers where safe.' },
  { name: 'nova_web_search', title: 'Web Search', defaultEnabled: true, readOnly: true, category: 'web', description: 'Bounded DuckDuckGo-backed search using Nova web_search.' },
  { name: 'nova_eval_list_scenarios', title: 'Eval Scenarios', defaultEnabled: true, readOnly: true, category: 'eval', description: 'List eval scenario metadata without exposing eval reports.' },
  { name: 'nova_eval_schema_info', title: 'Eval Schema Info', defaultEnabled: true, readOnly: true, category: 'eval', description: 'Describe trace/eval schema versions and report locations at a high level.' },
  { name: 'nova_trace_summarize', title: 'Trace Summary', defaultEnabled: true, readOnly: true, category: 'trace', description: 'Return sanitized aggregate trace summaries only; no raw trace contents.' },
  { name: 'nova_write_file', title: 'Write File', defaultEnabled: false, readOnly: false, category: 'disabled', description: 'Not registered by default; write scope is intentionally unavailable in V1.1.' },
  { name: 'nova_bash', title: 'Bash', defaultEnabled: false, readOnly: false, category: 'disabled', description: 'Not registered by default; shell execution is intentionally unavailable in V1.1.' },
];

const RESOURCE_DEFS = [
  { name: 'nova_mcp_status', uri: 'nova://docs/status', title: 'Nova MCP Status', description: 'Current MCP phase/status summary.', contentKind: 'markdown' },
  { name: 'nova_mcp_readme', uri: 'nova://docs/mcp/readme', title: 'MCP README', description: 'MCP server overview.', contentKind: 'markdown' },
  { name: 'nova_mcp_tools', uri: 'nova://docs/mcp/tools', title: 'MCP Tools', description: 'Tool contract and safety annotations.', contentKind: 'markdown' },
  { name: 'nova_mcp_security', uri: 'nova://docs/mcp/security', title: 'MCP Security', description: 'Read-only policy and denied surfaces.', contentKind: 'markdown' },
  { name: 'nova_mcp_resources', uri: 'nova://docs/mcp/resources', title: 'MCP Resources', description: 'Curated nova:// resources.', contentKind: 'markdown' },
  { name: 'nova_mcp_prompts', uri: 'nova://docs/mcp/prompts', title: 'MCP Prompts', description: 'Prompt catalog.', contentKind: 'markdown' },
  { name: 'nova_mcp_client_setup', uri: 'nova://docs/mcp/client-setup', title: 'MCP Client Setup', description: 'Client and Inspector setup.', contentKind: 'markdown' },
  { name: 'nova_mcp_capabilities_resource', uri: 'nova://mcp/capabilities', title: 'MCP Capabilities', description: 'Generated capabilities and limits summary.', contentKind: 'json' },
  { name: 'nova_mcp_policy_resource', uri: 'nova://mcp/policy', title: 'MCP Policy Metadata', description: 'Generated read-only policy and non-goal summary.', contentKind: 'json' },
  { name: 'nova_mcp_gated_tools_policy', uri: 'nova://mcp/gated-tools-policy', title: 'Gated Tools Policy', description: 'Metadata-only roadmap and activation gates for future mutating/state tools; no actions enabled.', contentKind: 'json' },
  { name: 'nova_mcp_resource_schema_policy', uri: 'nova://resources/schema-policy', title: 'Resource Schema Policy', description: 'Stable MCP resource schema/versioning policy and resource inventory.', contentKind: 'json' },
  { name: 'nova_mcp_release_checklist', uri: 'nova://mcp/release-checklist', title: 'MCP Release Checklist', description: 'Generated MCP packaging/release readiness checklist and validation commands.', contentKind: 'json' },
  { name: 'nova_mcp_compatibility', uri: 'nova://mcp/compatibility', title: 'MCP Compatibility', description: 'Generated MCP Node/SDK/client compatibility expectations.', contentKind: 'json' },
  { name: 'nova_mcp_tool_schemas_resource', uri: 'nova://tools/schemas', title: 'Tool Schemas', description: 'Generated tool metadata and input schema summary.', contentKind: 'json' },
  { name: 'nova_mcp_docs_index_resource', uri: 'nova://docs/index', title: 'Docs Index', description: 'Curated high-value docs index for MCP clients.', contentKind: 'json' },
  { name: 'nova_tool_catalog_resource', uri: 'nova://tools/catalog', title: 'Tool Catalog', description: 'Generated tool catalog snapshot.', contentKind: 'markdown' },
  { name: 'nova_eval_scenarios_resource', uri: 'nova://eval/scenarios', title: 'Eval Scenarios', description: 'Default eval scenario IDs and tags only.', contentKind: 'json' },
  { name: 'nova_eval_schema_resource', uri: 'nova://eval/schema', title: 'Eval Schema Info', description: 'Eval and trace schema metadata only.', contentKind: 'json' },
  { name: 'nova_eval_recent_summary_resource', uri: 'nova://eval/recent-summary', title: 'Recent Eval Summary', description: 'Sanitized recent eval run summaries; no raw reports.', contentKind: 'json' },
  { name: 'nova_eval_latest_summary_resource', uri: 'nova://eval/latest-summary', title: 'Latest Eval Summary', description: 'Sanitized latest eval report summary; no raw report content.', contentKind: 'json' },
  { name: 'nova_reports_latest_summary_resource', uri: 'nova://reports/latest-summary', title: 'Latest Report Summary', description: 'Sanitized latest report/SLO summary; no raw report artifacts.', contentKind: 'json' },
  { name: 'nova_trace_summary_resource', uri: 'nova://trace/summary', title: 'Trace Summary', description: 'Sanitized aggregate trace summary; no raw trace events.', contentKind: 'json' },
  { name: 'nova_observability_summary_resource', uri: 'nova://observability/summary', title: 'Observability Summary', description: 'Sanitized eval/report/trace observability rollup.', contentKind: 'json' },
] as const;

type ResourceDefinition = (typeof RESOURCE_DEFS)[number];

function allowedRoots(): string[] {
  const extra = splitRootsEnv(process.env.NOVA_MCP_ALLOWED_ROOTS);
  return [PROJECT_ROOT, ...extra].map((entry) => resolve(entry));
}

function deniedReason(path: string): string | undefined {
  return deniedPathReason(path);
}

function resolvePolicyPath(inputPath: string, label = 'path'): string {
  const check = resolveSharedPolicyPath(inputPath, label, allowedRoots());
  if (!check.ok) throw new Error(`${DENIED_MESSAGE} Reason: ${check.reason}`);
  return check.path;
}

function safeRelative(path: string): string {
  return sharedSafeRelative(path, allowedRoots());
}

function isDeniedChild(path: string): boolean {
  return Boolean(deniedReason(path));
}

function redactText(text: string): string {
  return redactString(text, HARD_OUTPUT_MAX_CHARS);
}

function textResult(text: string, structuredContent: ToolPayload = {}, isError = false) {
  return { content: [{ type: 'text' as const, text }], structuredContent, isError };
}

function safeError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return textResult(`Error: ${redactText(message)}`, { ok: false, error: redactText(message) }, true);
}

async function readTextFilePolicy(path: string, maxChars: number, offset = 0, limit?: number) {
  const filePath = resolvePolicyPath(path, 'file path');
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error('path is not a file');
  if (fileStat.size > MAX_FILE_BYTES) throw new Error(`file exceeds MCP text read limit (${fileStat.size} bytes > ${MAX_FILE_BYTES} bytes)`);
  const raw = await readFile(filePath);
  if (raw.includes(0)) throw new Error('binary files are not readable through nova_read_file');
  let text = raw.toString('utf-8');
  if (containsPrivateKeyMaterial(text)) throw new Error(`${DENIED_MESSAGE} Reason: private key material detected in content`);
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, offset);
  const selected = limit ? lines.slice(start, start + Math.max(1, limit)) : lines.slice(start);
  text = redactText(selected.join('\n'));
  const capped = capText(text, maxChars);
  return {
    filePath,
    relPath: safeRelative(filePath),
    sizeBytes: fileStat.size,
    totalLines: lines.length,
    offset: start,
    returnedLines: selected.length,
    ...capped,
  };
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDangerousNestedQuantifier(pattern: string): boolean {
  // Conservative ReDoS guard for common catastrophic backtracking shapes such as
  // `(a+)+`, `(.*)*`, `([a-z]+){2,}`, or nested quantified groups.
  return /\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)\s*(?:[+*{])/.test(pattern)
    || /\((?:[^()\\]|\\.)*\.[*+](?:[^()\\]|\\.)*\)\s*(?:[+*{])/.test(pattern);
}

function buildSearchTextRegex(input: { pattern: string; regex?: boolean; ignoreCase?: boolean }): RegExp {
  if (input.pattern.length > MAX_SEARCH_PATTERN_CHARS) {
    throw new Error(`search pattern is too long; maximum is ${MAX_SEARCH_PATTERN_CHARS} characters.`);
  }
  const flags = input.ignoreCase ? 'i' : undefined;
  if (!input.regex) return new RegExp(escapeRegExp(input.pattern), flags);
  if (hasDangerousNestedQuantifier(input.pattern)) {
    throw new Error('search regex was rejected by Nova MCP ReDoS safeguards; simplify the pattern or use literal search.');
  }
  return new RegExp(input.pattern, flags);
}

async function walkFiles(root: string, options: { maxFiles: number; includeDirs?: boolean; maxDepth?: number }) {
  const out: string[] = [];
  let skippedDenied = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= options.maxFiles || depth > (options.maxDepth ?? 8)) return;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= options.maxFiles) break;
      const full = join(dir, entry.name);
      if (isDeniedChild(full)) {
        skippedDenied++;
        continue;
      }
      if (entry.isDirectory()) {
        if (options.includeDirs) out.push(full);
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return { files: out, skippedDenied };
}

function formatJsonMarkdown(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function generatedCapabilities() {
  return {
    version: VERSION,
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    resourceSchemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    resourcePolicyVersion: MCP_RESOURCE_POLICY_VERSION,
    transport: { default: 'stdio', http: 'not implemented/enabled in this V1.1 slice', networkExposure: 'none by default' },
    posture: { defaultReadOnly: true, startupCreatesFiles: false, mutatingToolsRegisteredByDefault: false },
    limits: {
      hardOutputMaxChars: HARD_OUTPUT_MAX_CHARS,
      maxFileBytes: MAX_FILE_BYTES,
      maxDirectoryEntries: MAX_DIR_ENTRIES,
      maxSearchFiles: MAX_SEARCH_FILES,
      maxTextMatches: MAX_TEXT_MATCHES,
      maxSearchPatternChars: MAX_SEARCH_PATTERN_CHARS,
    },
    toolCounts: {
      enabled: toolCatalog.filter((tool) => tool.defaultEnabled).length,
      disabled: toolCatalog.filter((tool) => !tool.defaultEnabled).length,
      totalCatalogEntries: toolCatalog.length,
    },
    resources: RESOURCE_DEFS.map(resourceSummary),
    prompts: ['nova_repository_orientation', 'nova_readonly_review', 'nova_tool_safety_review', 'nova_eval_scenario_design', 'nova_trace_summary_diagnosis', 'nova_mcp_client_setup'],
    disabledToolFamilies: ['nova_bash', 'nova_write_file', 'nova_todo_*', 'nova_goal_*', 'nova_skill_*'],
    gatedToolsPolicyResource: 'nova://mcp/gated-tools-policy',
    compatibility: { node: MCP_NODE_COMPATIBILITY, sdk: MCP_SDK_COMPATIBILITY },
  };
}

function generatedPolicyMetadata() {
  return {
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    resourceSchemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    resourcePolicyVersion: MCP_RESOURCE_POLICY_VERSION,
    allowedRoots: 'configured locally; enforced but not disclosed by MCP tools/resources',
    deniedSurfaces: ['.env', '.env.*', '.git', 'node_modules', 'raw .nova/traces', 'raw .nova/evals', 'raw .nova/reports', 'private key extensions', 'secret-like filenames'],
    contentProtections: ['private key content refusal', 'secret-like string redaction', 'output caps and truncation metadata', 'safe errors without allowed-root disclosure'],
    searchPolicy: { default: 'literal', regexOptIn: true, maxPatternChars: MAX_SEARCH_PATTERN_CHARS, redosGuard: true },
    mutatingTools: { nova_bash: 'absent by default', nova_write_file: 'absent by default', stateTools: 'absent by default' },
    transportPolicy: { stdio: 'default', http: 'not enabled in this slice', publicBind: 'non-goal' },
    compatibility: { node: MCP_NODE_COMPATIBILITY, sdk: MCP_SDK_COMPATIBILITY },
  };
}

function generatedGatedToolsPolicy() {
  return {
    kind: 'mcp_gated_tools_policy',
    packageVersion: VERSION,
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    policyVersion: MCP_RESOURCE_POLICY_VERSION,
    currentDefault: {
      readOnly: true,
      stdioOnly: true,
      mutatingToolsRegisteredByDefault: false,
      novaBashRegistered: false,
      novaWriteFileRegistered: false,
      stateToolsRegistered: false,
      actionsImplementedInThisSlice: false,
    },
    candidateFamilies: [
      {
        family: 'nova_bash',
        status: 'absent_by_default',
        futureRegistrationGate: 'NOVA_MCP_ENABLE_BASH=1 plus explicit operator approval and documented command policy',
        requiredBeforeRegistration: [
          'dry-run preview for command intent and working directory',
          'command allow/deny policy including destructive-command refusal',
          'cwd constrained to allowed roots without root disclosure',
          'timeout, output caps, env allow-list, and process cleanup',
          'human approval semantics and denial handling',
          'audit log with redacted command/target/result summaries only',
        ],
      },
      {
        family: 'nova_write_file',
        status: 'absent_by_default',
        futureRegistrationGate: 'NOVA_MCP_ENABLE_WRITE_FILE=1 plus explicit operator approval and documented write policy',
        requiredBeforeRegistration: [
          'dry-run diff preview before writes',
          'allowed extensions and allowed-root constraints',
          'atomic write and backup/rollback policy',
          'refusal for denied paths, secret-like filenames, and private-key material',
          'human approval semantics and denial handling',
          'audit log with redacted target/diff/result summaries only',
        ],
      },
      {
        family: 'nova_todo_* / nova_goal_* / nova_skill_*',
        status: 'absent_by_default',
        futureRegistrationGate: 'NOVA_MCP_ENABLE_STATE_TOOLS=1 plus documented local storage and cleanup policy',
        requiredBeforeRegistration: [
          'state storage location and schema documented',
          'export/redaction behavior documented',
          'cleanup/retention policy documented',
          'no raw secret or raw .nova artifact persistence',
          'idempotent operations and conflict behavior documented',
          'audit log with redacted intent/result summaries only',
        ],
      },
    ],
    universalGates: [
      'explicit environment flag per family before registration',
      'disabled by default in package and source checkout',
      'documented dry-run mode before execution/mutation',
      'human approval requirement for write/shell side effects',
      'redacted audit logging without secrets, raw file contents, raw .nova artifacts, or configured root disclosure',
      'targeted smoke, Inspector, and eval coverage before activation',
      'no weakening of allowed-root, denylist, redaction, output-cap, or transport policies',
    ],
    nonGoalsForThisSlice: ['No nova_bash registration', 'No nova_write_file registration', 'No state tool registration', 'No write/shell/state action implementation', 'No HTTP/streamable transport'],
    validation: {
      requiredAbsentTools: ['nova_bash', 'nova_write_file', 'nova_todo_create', 'nova_goal_create', 'nova_skill_create'],
      expectedChecks: ['mcp:smoke', 'mcp:inspect', 'eval:mcp'],
    },
  };
}

function resourceSummary(def: ResourceDefinition) {
  return {
    uri: def.uri,
    title: def.title,
    description: def.description,
    contentKind: def.contentKind,
    schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
  };
}

function generatedResourceSchemaPolicy() {
  return {
    kind: 'mcp_resource_schema_policy',
    packageVersion: VERSION,
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    resourceSchemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    resourcePolicyVersion: MCP_RESOURCE_POLICY_VERSION,
    compatibility: {
      packageVersionSource: 'package.json / server version; unchanged for additive V1.1 resource metadata',
      behaviorVersion: 'Bumps only for MCP-visible behavior or compatibility contract changes.',
      resourceSchemaVersion: 'Bumps for incompatible resource payload shape changes; additive fields keep the same major schema version.',
      resourcePolicyVersion: 'Bumps when safety policy semantics change, including disclosure, redaction, transport, or mutating-tool posture.',
      uriStability: 'Existing nova:// resource URIs stay stable during a behavior version unless deprecated with docs and eval coverage.',
    },
    safetyInvariants: {
      curatedResourcesOnly: true,
      rawFilesystemMirror: false,
      rawNovaArtifactsExposed: false,
      configuredRootsDisclosed: false,
      secretsExposed: false,
      stdioDefault: true,
      httpEnabled: false,
      mutatingToolsRegisteredByDefault: false,
    },
    requiredEnvelope: {
      jsonResources: ['kind', 'schemaVersion or resourceSchemaVersion when applicable', 'policy metadata for safety-sensitive summaries'],
      markdownResources: ['curated documentation text only; no raw sensitive local artifacts'],
      generatedResources: ['stable uri', 'title', 'description', 'contentKind', 'schemaVersion in policy inventory'],
    },
    resources: RESOURCE_DEFS.map(resourceSummary),
  };
}

function generatedMcpReleaseChecklist() {
  return {
    kind: 'mcp_release_checklist',
    packageVersion: VERSION,
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    scope: 'MCP stdio packaging and release readiness; metadata only, no publish/tag/release action.',
    compatibility: { node: MCP_NODE_COMPATIBILITY, sdk: MCP_SDK_COMPATIBILITY },
    requiredCommands: [
      'npm run typecheck',
      'npm run mcp:smoke',
      'npm run mcp:inspect',
      'npm run mcp:bin-smoke',
      'npm run eval:mcp',
      'npm run build',
      'npm run check',
      'npm run release:readiness',
    ],
    packagingChecks: [
      'nova-mcp bin is present in package.json bin map and accepts only --help/--version metadata args before stdio startup.',
      'Package files include bin/, dist/, scripts/assert-release-readiness.mjs, docs/mcp/*.md, packaging docs, changelog, and safe project docs.',
      'Package manifest excludes source tree, .nova, node_modules, .env files, and built smoke artifacts.',
      'npm pack dry-run should be run with --ignore-scripts for manifest inspection when a read-only packaging check is required.',
    ],
    safetyInvariants: {
      stdioDefault: true,
      httpOrStreamableEnabled: false,
      mutatingToolsRegisteredByDefault: false,
      rawNovaArtifactsPackagedOrExposed: false,
      secretsPackagedOrExposed: false,
      configuredRootsDisclosed: false,
    },
    manualReleaseNonGoals: ['No npm publish', 'No git tag', 'No GitHub release', 'No HTTP/streamable transport enablement'],
    docs: ['docs/mcp/CLIENT_SETUP.md', 'docs/mcp/README.md', 'docs/mcp/RESOURCES.md', 'docs/mcp/BACKLOG_V1_1.md', 'docs/packaging-install.md'],
  };
}

function generatedMcpCompatibility() {
  return {
    kind: 'mcp_compatibility',
    packageVersion: VERSION,
    mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
    runtime: {
      node: MCP_NODE_COMPATIBILITY,
      ciNodeVersion: 22,
      moduleSystem: 'ESM',
      builtEntrypoint: 'dist/mcp/server.js',
      devEntrypointFallback: 'src/mcp/server.ts via tsx',
    },
    sdk: {
      package: MCP_SDK_COMPATIBILITY,
      transport: 'stdio only by default',
      clientExpectation: 'MCP clients should launch nova-mcp through stdio and read curated nova:// resources; no HTTP endpoint is exposed.',
    },
    packageEntrypoints: {
      bin: 'nova-mcp',
      direct: 'node bin/nova-mcp.js',
      npmExec: 'npm exec --yes --package @lux-tech/nova-agent -- nova-mcp',
    },
    unsupportedByDefault: ['HTTP transport', 'streamable HTTP transport', 'remote bind', 'nova_bash tool', 'nova_write_file tool', 'state tools'],
    versioning: {
      packageVersion: VERSION,
      mcpBehaviorVersion: MCP_BEHAVIOR_VERSION,
      resourceSchemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
      resourcePolicyVersion: MCP_RESOURCE_POLICY_VERSION,
    },
  };
}

function generatedToolSchemas() {
  const inputSummaries: Record<string, Record<string, string>> = {
    nova_tool_catalog: {},
    nova_mcp_capabilities: {},
    nova_read_file: { path: 'string required', offset: 'int>=0 optional', limit: '1..2000 optional', maxChars: `1000..${HARD_OUTPUT_MAX_CHARS} optional` },
    nova_list_directory: { path: 'string optional', recursive: 'boolean optional', maxEntries: `1..${MAX_DIR_ENTRIES} optional` },
    nova_search_files: { pattern: 'glob-like string default **/*', root: 'string optional', maxResults: `1..${MAX_SEARCH_FILES} optional` },
    nova_search_text: { pattern: 'string required', regex: 'boolean optional default false', root: 'string optional', include: 'glob optional', ignoreCase: 'boolean optional', maxResults: `1..${MAX_TEXT_MATCHES} optional` },
    nova_git_status: { cwd: 'string optional', maxChars: `1000..${HARD_OUTPUT_MAX_CHARS} optional` },
    nova_git_diff: { cwd: 'string optional', staged: 'boolean optional', statOnly: 'boolean optional', maxChars: `1000..${HARD_OUTPUT_MAX_CHARS} optional` },
    nova_git_log: { cwd: 'string optional', maxCount: '1..50 optional', maxChars: `1000..${HARD_OUTPUT_MAX_CHARS} optional` },
    nova_doc_read: { path: 'string required', mode: 'string optional', query: 'string optional', maxChars: `1000..${HARD_OUTPUT_MAX_CHARS} optional` },
    nova_web_search: { query: 'string required', maxResults: '1..10 optional', timeout: '1000..15000 optional' },
    nova_eval_list_scenarios: { suite: 'string optional' },
    nova_eval_schema_info: {},
    nova_trace_summarize: { limit: '1..100 optional' },
  };
  return toolCatalog.map((tool) => ({ ...tool, input: inputSummaries[tool.name] ?? {}, registered: tool.defaultEnabled }));
}

function generatedDocsIndex() {
  return [
    { path: 'docs/mcp/README.md', topic: 'MCP overview and safe defaults' },
    { path: 'docs/mcp/TOOLS.md', topic: 'Tool catalog and disabled mutating tools' },
    { path: 'docs/mcp/SECURITY.md', topic: 'Read-only policy and denied surfaces' },
    { path: 'docs/mcp/RESOURCES.md', topic: 'Curated nova:// resources' },
    { path: 'docs/mcp/PROMPTS.md', topic: 'Prompt catalog' },
    { path: 'docs/mcp/CLIENT_SETUP.md', topic: 'Client and Inspector setup' },
    { path: 'docs/mcp/BACKLOG_V1_1.md', topic: 'V1.1 backlog and acceptance criteria' },
    { path: 'docs/packaging-install.md', topic: 'CLI and MCP package/bin installation guidance' },
    { path: 'PROJECT_STATUS.md', topic: 'Project status summaries' },
    { path: 'CHANGELOG.md', topic: 'Released and unreleased changes' },
  ];
}

type JsonSafe = null | boolean | number | string | JsonSafe[] | { [key: string]: JsonSafe };

function sanitizeObservabilityString(value: string): string {
  return redactText(value)
    .replaceAll(PROJECT_ROOT, '<project-root>')
    .replace(/[A-Za-z]:\\[^\s"',}]+/g, '<path>')
    .replace(/\/[A-Za-z0-9._/-]*\.nova\/[A-Za-z0-9._/-]*/g, '<path>');
}

function sanitizeObservabilityValue(value: unknown, depth = 0): JsonSafe {
  if (depth > 6) return '[max-depth]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return sanitizeObservabilityString(value);
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeObservabilityValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: { [key: string]: JsonSafe } = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if ((lower.includes('path') && lower !== 'pathdisclosure') || lower === 'directory' || lower === 'events' || lower === 'content' || lower === 'raw') {
        out[key] = '<omitted>';
      } else {
        out[key] = sanitizeObservabilityValue(nested, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function observabilityPolicy() {
  return {
    sanitized: true,
    rawArtifactsExposed: false,
    pathDisclosure: false,
    contentIncluded: false,
    notes: 'Only counters, statuses, run identifiers, timestamps, gates, failures, and aggregate metrics are exposed.',
  };
}

async function generatedEvalRecentSummary() {
  const runs = await listEvalReports({ limit: 10 }).catch(() => []);
  return sanitizeObservabilityValue({
    kind: 'eval_recent_summary',
    schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    policy: observabilityPolicy(),
    runCount: runs.length,
    runs: runs.map(({ reportPath: _reportPath, ...run }) => run),
  });
}

async function generatedEvalLatestSummary() {
  try {
    const { report, path } = await latestEvalReport();
    const summary = summarizeEvalReport(report, path);
    return sanitizeObservabilityValue({
      kind: 'eval_latest_summary',
      schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
      policy: observabilityPolicy(),
      summary,
    });
  } catch (err) {
    return sanitizeObservabilityValue({ kind: 'eval_latest_summary', schemaVersion: MCP_RESOURCE_SCHEMA_VERSION, policy: observabilityPolicy(), available: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

async function generatedReportLatestSummary() {
  try {
    const { report, path } = await latestEvalReport();
    const summary = summarizeEvalReport(report, path);
    const slo = buildEvalSloDashboard(summary);
    return sanitizeObservabilityValue({
      kind: 'report_latest_summary',
      schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
      policy: observabilityPolicy(),
      report: summary,
      slo,
    });
  } catch (err) {
    return sanitizeObservabilityValue({ kind: 'report_latest_summary', schemaVersion: MCP_RESOURCE_SCHEMA_VERSION, policy: observabilityPolicy(), available: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

async function generatedTraceSummary() {
  const summary = await summarizeTraces({ limit: 25 }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  return sanitizeObservabilityValue({
    kind: 'trace_summary',
    schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    policy: observabilityPolicy(),
    summary,
  });
}

async function generatedObservabilitySummary() {
  const [evalRecent, evalLatest, reportsLatest, traceSummary] = await Promise.all([
    generatedEvalRecentSummary(),
    generatedEvalLatestSummary(),
    generatedReportLatestSummary(),
    generatedTraceSummary(),
  ]);
  return sanitizeObservabilityValue({
    kind: 'observability_summary',
    schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
    policy: observabilityPolicy(),
    evalRecent,
    evalLatest,
    reportsLatest,
    traceSummary,
  });
}

async function runGit(args: string[], cwd: string, maxChars: number): Promise<{ output: string; exitCode: number | null; timedOut: boolean; truncated: boolean }> {
  const safeCwd = resolvePolicyPath(cwd, 'git cwd');
  const timeoutMs = 15_000;
  const child = spawn('git', ['-c', 'color.ui=false', '-c', 'core.pager=cat', '-C', safeCwd, ...args], {
    cwd: safeCwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' },
    windowsHide: true,
  });
  let output = '';
  let timedOut = false;
  let killed = false;
  const append = (chunk: Buffer) => {
    if (output.length < maxChars) output += chunk.toString('utf8').slice(0, maxChars - output.length);
    if (output.length >= maxChars && !killed) {
      killed = true;
      child.kill();
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', (chunk) => append(Buffer.from(`[stderr]\n${chunk.toString('utf8')}`)));
  child.stdin.end();
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const exitCode = await new Promise<number | null>((resolveDone, rejectDone) => {
    child.once('error', rejectDone);
    child.once('close', (code) => resolveDone(code));
  }).finally(() => clearTimeout(timer));
  return { output: redactText(output || '(no output)'), exitCode, timedOut, truncated: output.length >= maxChars };
}

async function assertGitDiffOutputAllowed(input: { cwd?: string; staged?: boolean; output?: string }): Promise<{ changedPathCount: number }> {
  const cwd = input.cwd ?? PROJECT_ROOT;
  const rootResult = await runGit(['rev-parse', '--show-toplevel'], cwd, 20_000);
  if (rootResult.exitCode !== 0) throw new Error('git repository root could not be resolved for diff safety preflight');
  const repoRoot = resolvePolicyPath(rootResult.output.trim().split(/\r?\n/)[0] ?? '', 'git repository root');
  const nameArgs = ['diff', '--no-ext-diff', '--no-color', '--name-only'];
  if (input.staged) nameArgs.push('--cached');
  const nameResult = await runGit(nameArgs, cwd, HARD_OUTPUT_MAX_CHARS);
  if (nameResult.exitCode !== 0) throw new Error('git diff changed-path preflight failed');
  if (nameResult.truncated) throw new Error(`${DENIED_MESSAGE} Reason: git diff changed-path preflight exceeded safety output limit`);
  const changedPaths = nameResult.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const relPath of changedPaths) {
    const resolved = resolve(repoRoot, relPath);
    const check = resolveSharedPolicyPath(resolved, 'git diff changed path', allowedRoots());
    const reason = check.ok ? deniedReason(check.path) : check.reason;
    if (reason) throw new Error(`${DENIED_MESSAGE} Reason: changed path is denied by policy (${reason})`);
  }
  if (input.output && containsPrivateKeyMaterial(input.output)) {
    throw new Error(`${DENIED_MESSAGE} Reason: private key material detected in git diff output`);
  }
  return { changedPathCount: changedPaths.length };
}

function registerTools(server: McpServer): void {
  server.registerTool('nova_tool_catalog', {
    title: 'Nova Tool Catalog',
    description: 'List Nova MCP tools, including disabled/gated tools, read-only posture, and security notes.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => textResult(formatJsonMarkdown({ tools: toolCatalog, allowedRootPolicy: 'configured roots are enforced but not disclosed by this tool', defaults: { readOnly: true, bash: 'absent', write_file: 'absent' } }), { tools: toolCatalog }));

  server.registerTool('nova_mcp_capabilities', {
    title: 'Nova MCP Capabilities',
    description: 'Return a curated read-only summary of MCP capabilities, limits, resources, prompts, and disabled mutating tool families.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const capabilities = generatedCapabilities();
    return textResult(formatJsonMarkdown(capabilities), { ok: true, capabilities });
  });

  server.registerTool('nova_read_file', {
    title: 'Read File',
    description: 'Read a policy-approved UTF-8 text file under allowed roots. Denies .env, raw .nova artifacts, .git internals, node_modules, private keys, and secret-like filenames.',
    inputSchema: z.object({ path: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(2000).optional(), maxChars: z.number().int().min(1000).max(HARD_OUTPUT_MAX_CHARS).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const data = await readTextFilePolicy(input.path, clampOutputLimit(input.maxChars), input.offset ?? 0, input.limit);
      const header = `File: ${data.relPath}\nSize: ${data.sizeBytes} bytes | Lines: ${data.totalLines} | Returned lines: ${data.returnedLines}\nTruncated: ${data.truncated}\n`;
      return textResult(`${header}\n${data.text}`, { ok: true, ...data, text: undefined });
    } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_list_directory', {
    title: 'List Directory',
    description: 'List a policy-approved directory, skipping denied children and reporting skip counts.',
    inputSchema: z.object({ path: z.string().optional(), recursive: z.boolean().optional(), maxEntries: z.number().int().min(1).max(MAX_DIR_ENTRIES).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const dir = resolvePolicyPath(input.path ?? '.', 'directory path');
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) throw new Error('path is not a directory');
      const maxEntries = input.maxEntries ?? 100;
      const entries: Array<{ name: string; type: 'file' | 'directory'; size?: number; modified?: string }> = [];
      let skippedDenied = 0;
      const collect = async (current: string, depth: number): Promise<void> => {
        if (entries.length >= maxEntries) return;
        for (const entry of await readdir(current, { withFileTypes: true })) {
          if (entries.length >= maxEntries) break;
          const full = join(current, entry.name);
          if (isDeniedChild(full)) { skippedDenied++; continue; }
          const s = await stat(full).catch(() => undefined);
          entries.push({ name: safeRelative(full), type: entry.isDirectory() ? 'directory' : 'file', size: entry.isFile() ? s?.size : undefined, modified: s?.mtime.toISOString() });
          if (input.recursive && entry.isDirectory() && depth < 3) await collect(full, depth + 1);
        }
      };
      await collect(dir, 0);
      return textResult(formatJsonMarkdown({ directory: safeRelative(dir), entries, skippedDenied, truncated: entries.length >= maxEntries }), { ok: true, directory: safeRelative(dir), entries, skippedDenied, truncated: entries.length >= maxEntries });
    } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_search_files', {
    title: 'Search Files',
    description: 'Search policy-approved file paths by glob-like pattern. Denied paths are skipped and never returned.',
    inputSchema: z.object({ pattern: z.string().default('**/*'), root: z.string().optional(), maxResults: z.number().int().min(1).max(MAX_SEARCH_FILES).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const root = resolvePolicyPath(input.root ?? '.', 'search root');
      const maxResults = input.maxResults ?? 100;
      const regex = globToRegex(input.pattern);
      const walked = await walkFiles(root, { maxFiles: MAX_SEARCH_FILES, maxDepth: 8 });
      const matches = walked.files.map((file) => safeRelative(file).replace(/\\/g, '/')).filter((file) => regex.test(file)).slice(0, maxResults);
      return textResult(formatJsonMarkdown({ pattern: input.pattern, root: safeRelative(root), matches, skippedDenied: walked.skippedDenied, truncated: walked.files.length >= MAX_SEARCH_FILES || matches.length >= maxResults }), { ok: true, matches, skippedDenied: walked.skippedDenied });
    } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_search_text', {
    title: 'Search Text',
    description: 'Search literal text by default in policy-approved files. Set regex: true for guarded regular expressions. Binary, oversized, and denied files are skipped.',
    inputSchema: z.object({ pattern: z.string(), regex: z.boolean().optional(), root: z.string().optional(), include: z.string().optional(), ignoreCase: z.boolean().optional(), maxResults: z.number().int().min(1).max(MAX_TEXT_MATCHES).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const root = resolvePolicyPath(input.root ?? '.', 'search root');
      const maxResults = input.maxResults ?? 50;
      const regex = buildSearchTextRegex(input);
      const includeRegex = input.include ? globToRegex(input.include.includes('/') ? input.include : `**/${input.include}`) : undefined;
      const walked = await walkFiles(root, { maxFiles: MAX_SEARCH_FILES, maxDepth: 8 });
      const matches: Array<{ file: string; line: number; text: string }> = [];
      for (const file of walked.files) {
        if (matches.length >= maxResults) break;
        const rel = safeRelative(file).replace(/\\/g, '/');
        if (includeRegex && !includeRegex.test(rel)) continue;
        const s = await stat(file).catch(() => undefined);
        if (!s?.isFile() || s.size > MAX_FILE_BYTES) continue;
        const stream = createReadStream(file, { encoding: 'utf-8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        let lineNo = 0;
        for await (const line of rl) {
          lineNo++;
          if (regex.test(line)) {
            if (containsPrivateKeyMaterial(line)) continue;
            matches.push({ file: rel, line: lineNo, text: capText(redactText(line), 500).text });
            if (matches.length >= maxResults) break;
          }
        }
      }
      return textResult(formatJsonMarkdown({ pattern: input.pattern, regex: input.regex === true, matches, skippedDenied: walked.skippedDenied, truncated: matches.length >= maxResults }), { ok: true, matches, skippedDenied: walked.skippedDenied });
    } catch (err) { return safeError(err); }
  });

  const gitCwdSchema = { cwd: z.string().optional(), maxChars: z.number().int().min(1000).max(HARD_OUTPUT_MAX_CHARS).optional() };
  server.registerTool('nova_git_status', { title: 'Git Status', description: 'Read-only git status --short --branch.', inputSchema: z.object(gitCwdSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => {
    try { const result = await runGit(['status', '--short', '--branch', '--untracked-files=all'], input.cwd ?? PROJECT_ROOT, clampOutputLimit(input.maxChars)); return textResult(result.output, { ok: result.exitCode === 0, ...result }); } catch (err) { return safeError(err); }
  });
  server.registerTool('nova_git_diff', { title: 'Git Diff', description: 'Read-only git diff. Output is redacted and capped; raw sensitive artifacts remain denied by file tools.', inputSchema: z.object({ ...gitCwdSchema, staged: z.boolean().optional(), statOnly: z.boolean().optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => {
    try {
      await assertGitDiffOutputAllowed({ cwd: input.cwd, staged: input.staged });
      const args = ['diff', '--no-ext-diff', '--no-color', input.statOnly ? '--stat' : '--unified=3'];
      if (input.staged) args.push('--cached');
      const result = await runGit(args, input.cwd ?? PROJECT_ROOT, clampOutputLimit(input.maxChars));
      const safety = await assertGitDiffOutputAllowed({ cwd: input.cwd, staged: input.staged, output: result.output });
      return textResult(result.output, { ok: result.exitCode === 0, ...result, changedPathCount: safety.changedPathCount });
    } catch (err) { return safeError(err); }
  });
  server.registerTool('nova_git_log', { title: 'Git Log', description: 'Read-only git log with max count.', inputSchema: z.object({ ...gitCwdSchema, maxCount: z.number().int().min(1).max(50).optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => {
    try { const result = await runGit(['log', `--max-count=${input.maxCount ?? 10}`, '--date=iso-strict', '--decorate=short', '--pretty=format:%h\t%ad\t%d\t%s'], input.cwd ?? PROJECT_ROOT, clampOutputLimit(input.maxChars)); return textResult(result.output, { ok: result.exitCode === 0, ...result }); } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_doc_read', {
    title: 'Read Document',
    description: 'Read policy-approved .pdf, .docx, .xlsx, .md, or .txt documents. Raw sensitive artifacts are denied before parsing.',
    inputSchema: z.object({ path: z.string(), mode: z.string().optional(), query: z.string().optional(), maxChars: z.number().int().min(1000).max(HARD_OUTPUT_MAX_CHARS).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const filePath = resolvePolicyPath(input.path, 'document path');
      const ext = extname(filePath).toLowerCase();
      const maxChars = clampOutputLimit(input.maxChars);
      let output: string;
      if (ext === '.pdf') output = await readPdfTool.execute({ path: filePath, mode: input.mode ?? 'text', query: input.query, maxPages: 10, maxCharsPerPage: 10_000 }) as string;
      else if (ext === '.docx') output = await readDocxTool.execute({ path: filePath, mode: input.mode ?? 'text', query: input.query, maxChars }) as string;
      else if (ext === '.xlsx') output = await readExcelTool.execute({ path: filePath, mode: input.mode ?? 'sheets', query: input.query, maxChars }) as string;
      else if (['.md', '.txt'].includes(ext)) output = (await readTextFilePolicy(filePath, maxChars)).text;
      else throw new Error('unsupported document type; allowed: .pdf, .docx, .xlsx, .md, .txt');
      const capped = capText(redactText(output), maxChars);
      return textResult(capped.text, { ok: true, path: safeRelative(filePath), truncated: capped.truncated, originalChars: capped.originalChars });
    } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_web_search', {
    title: 'Web Search',
    description: 'Bounded web search via existing Nova web_search tool. No API keys required; does not fetch result pages.',
    inputSchema: z.object({ query: z.string(), maxResults: z.number().int().min(1).max(10).optional(), timeout: z.number().int().min(1000).max(15_000).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => {
    try { const output = await webSearchTool.execute({ ...input, maxChars: 20_000 }) as string; return textResult(redactText(output), { ok: true }); } catch (err) { return safeError(err); }
  });

  server.registerTool('nova_eval_list_scenarios', {
    title: 'List Eval Scenarios',
    description: 'List built-in eval scenario metadata and suites. Does not read .nova/evals reports.',
    inputSchema: z.object({ suite: z.string().optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const suiteIds: Set<string> | undefined = input.suite && input.suite in evalSuites ? new Set<string>(evalSuites[input.suite as keyof typeof evalSuites]) : undefined;
    const scenarios = defaultScenarios.filter((s) => !suiteIds || suiteIds.has(s.id)).map(({ id, name, description, tags, expectedTools, expectedAnyTools, forbiddenTools }) => ({ id, name, description, tags, expectedTools, expectedAnyTools, forbiddenTools }));
    return textResult(formatJsonMarkdown({ schemaVersion: EVAL_SCHEMA_VERSION, suites: listSuites(), scenarios }), { scenarios, suites: listSuites() });
  });

  server.registerTool('nova_eval_schema_info', {
    title: 'Eval Schema Info',
    description: 'Show eval/trace schema versions and safe artifact policy without exposing raw reports.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const info = { evalSchemaVersion: EVAL_SCHEMA_VERSION, traceSchemaVersion: TRACE_SCHEMA_VERSION, reportPolicy: '.nova/evals raw reports are denied via filesystem tools; use eval list/schema summaries only.', tracePolicy: '.nova/traces raw files are denied; nova_trace_summarize returns aggregate sanitized metrics only.' };
    return textResult(formatJsonMarkdown(info), info);
  });

  server.registerTool('nova_trace_summarize', {
    title: 'Trace Summary',
    description: 'Summarize local traces as aggregate metrics and insights only. Raw trace files and event payloads are never returned.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const summary = await summarizeTraces({ limit: input.limit ?? 25 });
      const sanitized = { ...summary, directory: safeRelative(summary.directory), recentRuns: summary.recentRuns.map(({ outputPath: _outputPath, ...run }) => run) };
      return textResult(formatJsonMarkdown(sanitized), { ok: true, summary: sanitized });
    } catch (err) { return safeError(err); }
  });
}

async function readDocResource(path: string, fallback: string): Promise<string> {
  try {
    const resolved = resolvePolicyPath(path, 'resource path');
    const text = await readFile(resolved, 'utf-8');
    if (containsPrivateKeyMaterial(text)) return fallback;
    return redactText(text);
  } catch {
    return fallback;
  }
}

function generatedStatus(): string {
  return `# Nova MCP Status\n\n- MCP server V1.1: implemented at \`src/mcp/server.ts\`\n- Transport: stdio via official \`@modelcontextprotocol/sdk\`\n- Default scope: read-only\n- Disabled by default: \`nova_bash\`, \`nova_write_file\`, and state tools are not registered\n- Allowed roots: configured locally and enforced without disclosure in tool errors\n- V1.1 metadata resources: \`nova://mcp/capabilities\`, \`nova://mcp/policy\`, \`nova://tools/schemas\`, \`nova://docs/index\`\n`;
}

function generatedToolCatalog(): string {
  return `# Nova MCP Tool Catalog\n\n${toolCatalog.map((tool) => `- **${tool.name}** — ${tool.defaultEnabled ? 'enabled' : 'disabled/absent'} — ${tool.readOnly ? 'read-only' : 'write/exec'} — ${tool.description}`).join('\n')}\n`;
}

function resourceMimeType(def: ResourceDefinition): 'application/json' | 'text/markdown' {
  return def.contentKind === 'json' ? 'application/json' : 'text/markdown';
}

function registerResources(server: McpServer): void {
  const readers: Record<string, () => Promise<string> | string> = {
    'nova://docs/status': () => readDocResource('PROJECT_STATUS.md', generatedStatus()),
    'nova://docs/mcp/readme': () => readDocResource('docs/mcp/README.md', '# Nova MCP README\n'),
    'nova://docs/mcp/tools': () => readDocResource('docs/mcp/TOOLS.md', generatedToolCatalog()),
    'nova://docs/mcp/security': () => readDocResource('docs/mcp/SECURITY.md', '# Nova MCP Security\n'),
    'nova://docs/mcp/resources': () => readDocResource('docs/mcp/RESOURCES.md', '# Nova MCP Resources\n'),
    'nova://docs/mcp/prompts': () => readDocResource('docs/mcp/PROMPTS.md', '# Nova MCP Prompts\n'),
    'nova://docs/mcp/client-setup': () => readDocResource('docs/mcp/CLIENT_SETUP.md', '# Nova MCP Client Setup\n'),
    'nova://mcp/capabilities': () => JSON.stringify(generatedCapabilities(), null, 2),
    'nova://mcp/policy': () => JSON.stringify(generatedPolicyMetadata(), null, 2),
    'nova://mcp/gated-tools-policy': () => JSON.stringify(generatedGatedToolsPolicy(), null, 2),
    'nova://resources/schema-policy': () => JSON.stringify(generatedResourceSchemaPolicy(), null, 2),
    'nova://mcp/release-checklist': () => JSON.stringify(generatedMcpReleaseChecklist(), null, 2),
    'nova://mcp/compatibility': () => JSON.stringify(generatedMcpCompatibility(), null, 2),
    'nova://tools/schemas': () => JSON.stringify(generatedToolSchemas(), null, 2),
    'nova://docs/index': () => JSON.stringify(generatedDocsIndex(), null, 2),
    'nova://tools/catalog': generatedToolCatalog,
    'nova://eval/scenarios': () => JSON.stringify(defaultScenarios.map(({ id, name, tags, description }) => ({ id, name, tags, description })), null, 2),
    'nova://eval/schema': () => JSON.stringify({ kind: 'eval_schema_info', schemaVersion: MCP_RESOURCE_SCHEMA_VERSION, resourceSchemaVersion: MCP_RESOURCE_SCHEMA_VERSION, evalSchemaVersion: EVAL_SCHEMA_VERSION, traceSchemaVersion: TRACE_SCHEMA_VERSION, rawArtifacts: 'Denied by filesystem tools; use summaries only.' }, null, 2),
    'nova://eval/recent-summary': async () => JSON.stringify(await generatedEvalRecentSummary(), null, 2),
    'nova://eval/latest-summary': async () => JSON.stringify(await generatedEvalLatestSummary(), null, 2),
    'nova://reports/latest-summary': async () => JSON.stringify(await generatedReportLatestSummary(), null, 2),
    'nova://trace/summary': async () => JSON.stringify(await generatedTraceSummary(), null, 2),
    'nova://observability/summary': async () => JSON.stringify(await generatedObservabilitySummary(), null, 2),
  };
  for (const def of RESOURCE_DEFS) {
    const mimeType = resourceMimeType(def);
    server.registerResource(def.name, def.uri, { title: def.title, description: def.description, mimeType }, async (uri) => {
      const text = await readers[def.uri]();
      return { contents: [{ uri: uri.href, mimeType, text }] };
    });
  }
}

function promptMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt('nova_repository_orientation', { title: 'Repository Orientation', description: 'Guide an agent through read-only repository orientation.', argsSchema: { focus: z.string().optional() } }, (args) => promptMessage(`Use Nova MCP read-only tools to orient in this repository${args.focus ? ` with focus on ${args.focus}` : ''}. Start with nova_tool_catalog, nova_list_directory, nova_git_status, then targeted nova_read_file calls. Do not request write or bash capabilities.`));
  server.registerPrompt('nova_readonly_review', { title: 'Read-only Review', description: 'Review code/docs without modifying files.', argsSchema: { target: z.string().optional() } }, (args) => promptMessage(`Perform a read-only review${args.target ? ` of ${args.target}` : ''}. Use nova_search_files, nova_search_text, nova_read_file, nova_git_diff. Report findings with evidence and do not modify files.`));
  server.registerPrompt('nova_tool_safety_review', { title: 'Tool Safety Review', description: 'Evaluate MCP tool safety posture.', argsSchema: { concern: z.string().optional() } }, (args) => promptMessage(`Review Nova MCP tool safety${args.concern ? ` focusing on ${args.concern}` : ''}. Check catalog, SECURITY docs, denylist behavior, output caps, redaction, and disabled bash/write_file defaults.`));
  server.registerPrompt('nova_eval_scenario_design', { title: 'Eval Scenario Design', description: 'Design safe eval scenarios for Nova.', argsSchema: { area: z.string().optional() } }, (args) => promptMessage(`Design deterministic read-only eval scenarios${args.area ? ` for ${args.area}` : ''}. Use nova_eval_list_scenarios and nova_eval_schema_info. Avoid scenarios requiring secrets, network mutation, raw traces, or writes.`));
  server.registerPrompt('nova_trace_summary_diagnosis', { title: 'Trace Summary Diagnosis', description: 'Diagnose behavior from aggregate trace summaries only.', argsSchema: { symptom: z.string().optional() } }, (args) => promptMessage(`Diagnose Nova behavior from nova_trace_summarize only${args.symptom ? ` for symptom: ${args.symptom}` : ''}. Do not request raw trace files or .nova/evals reports.`));
  server.registerPrompt('nova_mcp_client_setup', { title: 'MCP Client Setup', description: 'Help configure an MCP client for Nova stdio.', argsSchema: { client: z.string().optional() } }, (args) => promptMessage(`Explain how to configure ${args.client ?? 'an MCP client'} for Nova using command \`npm run mcp:stdio\` in ${PROJECT_ROOT}. Include MCP Inspector command and security defaults.`));
}

export function createNovaMcpServer(): McpServer {
  const server = new McpServer({ name: 'nova-agent-mcp-server', version: VERSION }, {
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
      prompts: { listChanged: false },
    },
    instructions: 'Nova Agent MCP Server V1.1 exposes curated read-only tools/resources/prompts over stdio by default. Raw .env, .git internals, node_modules, private keys, and raw .nova trace/eval artifacts are denied; nova_bash, nova_write_file, and state tools remain absent by default.',
  });
  registerTools(server);
  registerResources(server);
  registerPrompts(server);
  return server;
}

export async function startNovaMcpStdioServer(): Promise<void> {
  const server = createNovaMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startNovaMcpStdioServer().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Nova MCP server failed: ${redactText(message)}`);
    process.exit(1);
  });
}
