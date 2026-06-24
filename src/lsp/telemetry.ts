import type { NovaMetadataIndex } from './metadata.js';
import { LSP_COMMANDS } from './metadata.js';
import { LSP_VERSION } from './policy.js';

export type LspTelemetrySummary = {
  kind: 'lsp_telemetry_summary';
  version: string;
  generatedAt: string;
  contentPolicy: {
    documentContentIncluded: false;
    rawDiagnosticsIncluded: false;
    uriIncluded: false;
    rootPathsIncluded: false;
    secretsIncluded: false;
  };
  server: {
    transport: 'stdio';
    workspaceEdit: false;
    codeActions: false;
    writeCommands: false;
    shellCommands: false;
  };
  metadata: {
    itemCount: number;
    packageScriptCount: number;
    evalSuiteCount: number;
    commandCount: number;
    readOnlyItemCount: number;
    nonReadOnlyItemCount: number;
    kinds: Record<string, number>;
  };
  diagnosticsPolicy: {
    maxDiagnostics: number;
    detectsEnvPaths: true;
    detectsRawNovaArtifacts: true;
    detectsSecretLikeContent: true;
    readsDeniedRawArtifacts: false;
  };
  validation: string[];
};

export function buildLspTelemetrySummary(metadata: NovaMetadataIndex, generatedAt = new Date().toISOString()): LspTelemetrySummary {
  const kinds: Record<string, number> = {};
  let readOnlyItemCount = 0;
  for (const item of metadata.items) {
    kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
    if (item.readOnly) readOnlyItemCount += 1;
  }

  return {
    kind: 'lsp_telemetry_summary',
    version: LSP_VERSION,
    generatedAt,
    contentPolicy: {
      documentContentIncluded: false,
      rawDiagnosticsIncluded: false,
      uriIncluded: false,
      rootPathsIncluded: false,
      secretsIncluded: false,
    },
    server: {
      transport: 'stdio',
      workspaceEdit: false,
      codeActions: false,
      writeCommands: false,
      shellCommands: false,
    },
    metadata: {
      itemCount: metadata.items.length,
      packageScriptCount: metadata.packageScripts.length,
      evalSuiteCount: metadata.evalSuites.length,
      commandCount: LSP_COMMANDS.length,
      readOnlyItemCount,
      nonReadOnlyItemCount: metadata.items.length - readOnlyItemCount,
      kinds,
    },
    diagnosticsPolicy: {
      maxDiagnostics: 100,
      detectsEnvPaths: true,
      detectsRawNovaArtifacts: true,
      detectsSecretLikeContent: true,
      readsDeniedRawArtifacts: false,
    },
    validation: ['npm run lsp:smoke', 'npm run lsp:policy-smoke', 'npm run eval:lsp'],
  };
}
