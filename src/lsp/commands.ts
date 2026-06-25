import type { ExecuteCommandParams } from 'vscode-languageserver/node';

import { defaultScenarios } from '../eval/scenarios.js';
import { capText, DENIED_MESSAGE } from './policy.js';
import { formatMetadataItem, LSP_COMMANDS } from './metadata.js';
import type { NovaMetadataIndex } from './metadata.js';
import { buildLspTelemetrySummary } from './telemetry.js';
import { buildLspDiagnosticsSummary } from './diagnostics_summary.js';

function argString(params: ExecuteCommandParams, fallback = ''): string {
  const first = params.arguments?.[0];
  return typeof first === 'string' ? first : fallback;
}

export function runReadOnlyCommand(params: ExecuteCommandParams, metadata: NovaMetadataIndex): unknown {
  if (!(LSP_COMMANDS as readonly string[]).includes(params.command)) {
    return { ok: false, error: 'Unknown or non-read-only Nova LSP command.' };
  }

  if (params.command === 'nova.lsp.showToolMetadata') {
    const query = argString(params).toLowerCase();
    const tools = metadata.items.filter((item) => item.kind === 'tool' && (!query || item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)));
    return { ok: true, readOnly: true, tools: tools.map((tool) => ({ label: tool.label, detail: tool.detail, readOnly: tool.readOnly })).slice(0, 50) };
  }

  if (params.command === 'nova.lsp.showRelatedDocs') {
    const query = argString(params).toLowerCase();
    const docs = metadata.items.filter((item) => item.kind === 'doc' && (!query || item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query)));
    return { ok: true, readOnly: true, docs: docs.map((doc) => ({ path: doc.path, title: doc.detail })).slice(0, 50) };
  }

  if (params.command === 'nova.lsp.explainPolicy') {
    return capText([
      '# Nova LSP V1 policy',
      '',
      '- Read-only by default: hover, completion, symbols, diagnostics, and metadata-only execute commands.',
      '- No WorkspaceEdit, no shell commands, no write commands, no autonomous self-rewrite.',
      `- ${DENIED_MESSAGE} Denies .env, .git, node_modules, raw .nova traces/evals/reports, private keys, secret-like paths/content, traversal, and outside-root paths.`,
      '- Outputs are capped and safe errors avoid stack traces and root-list disclosure.',
      '',
      ...metadata.items.filter((item) => item.kind === 'policy').map(formatMetadataItem),
    ].join('\n')).text;
  }

  if (params.command === 'nova.lsp.showEvalScenario') {
    const query = argString(params);
    const scenarios = defaultScenarios.filter((scenario) => !query || scenario.id === query || scenario.tags.includes(query));
    return { ok: true, readOnly: true, scenarios: scenarios.map(({ id, name, description, tags, expectedTools, expectedAnyTools, forbiddenTools }) => ({ id, name, description, tags, expectedTools, expectedAnyTools, forbiddenTools })).slice(0, 50) };
  }

  if (params.command === 'nova.lsp.showSetupGuide') {
    return {
      ok: true,
      readOnly: true,
      transport: 'stdio',
      workspaceEdit: false,
      writeCommands: false,
      shellCommands: false,
      clients: [
        {
          name: 'VS Code',
          command: 'npm',
          args: ['run', 'lsp:stdio'],
          notes: ['Use stdio transport.', 'Do not configure code actions that apply WorkspaceEdit.', 'Use diagnostics/hover/completion/symbols only.'],
        },
        {
          name: 'Neovim',
          command: 'npm',
          args: ['run', 'lsp:stdio'],
          notes: ['Configure as a stdio language server.', 'Set root_dir to the Nova checkout.', 'Do not add shell/write wrapper commands.'],
        },
      ],
      validation: ['npm run lsp:smoke', 'npm run eval:lsp'],
    };
  }

  if (params.command === 'nova.lsp.showTelemetrySummary') {
    return { ok: true, readOnly: true, summary: buildLspTelemetrySummary(metadata) };
  }

  if (params.command === 'nova.lsp.showDiagnosticsSummary') {
    return { ok: true, readOnly: true, summary: buildLspDiagnosticsSummary(metadata) };
  }

  return { ok: false, error: 'Unsupported Nova LSP command.' };
}
