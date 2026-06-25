import type { NovaMetadataIndex } from './metadata.js';

export type LspDiagnosticsSummary = {
  kind: 'lsp_diagnostics_summary';
  generatedAt: string;
  metadata: {
    itemCount: number;
    packageScriptCount: number;
    expectedScriptCount: number;
    missingExpectedScripts: string[];
    duplicateLabelCount: number;
    nonReadOnlyItemCount: number;
  };
  policy: {
    readOnly: true;
    transport: 'stdio';
    workspaceEdit: false;
    codeActions: false;
    writeCommands: false;
    shellCommands: false;
  };
  contentPolicy: {
    documentContentIncluded: false;
    rawDiagnosticsIncluded: false;
    uriIncluded: false;
    rootPathsIncluded: false;
    secretsIncluded: false;
  };
  validation: string[];
};

export function buildLspDiagnosticsSummary(metadata: NovaMetadataIndex, generatedAt = new Date().toISOString()): LspDiagnosticsSummary {
  return {
    kind: 'lsp_diagnostics_summary',
    generatedAt,
    metadata: {
      itemCount: metadata.items.length,
      packageScriptCount: metadata.packageScripts.length,
      expectedScriptCount: metadata.expectedScripts.length,
      missingExpectedScripts: metadata.missingExpectedScripts,
      duplicateLabelCount: metadata.duplicateLabels.length,
      nonReadOnlyItemCount: metadata.nonReadOnlyItems.length,
    },
    policy: {
      readOnly: true,
      transport: 'stdio',
      workspaceEdit: false,
      codeActions: false,
      writeCommands: false,
      shellCommands: false,
    },
    contentPolicy: {
      documentContentIncluded: false,
      rawDiagnosticsIncluded: false,
      uriIncluded: false,
      rootPathsIncluded: false,
      secretsIncluded: false,
    },
    validation: ['npm run lsp:policy-smoke', 'npm run lsp:smoke', 'npm run eval:lsp'],
  };
}
