import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePackageScriptCoverage } from '../security/read_only_matrix.js';

export type ProductionReadinessStatus = 'ready' | 'blocked' | 'warning';

export interface ProductionReadinessCheck {
  id: string;
  status: ProductionReadinessStatus;
  impact: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  evidence: string[];
  nextStep?: string;
}

export interface ProductionReadinessReport {
  schemaVersion: 1;
  name: 'production-install-readiness-v1';
  mode: 'offline-static';
  safety: {
    offlineOnly: true;
    readsEnv: false;
    readsSecrets: false;
    readsRawNovaArtifacts: false;
    invokesProviders: false;
    invokesTools: false;
    usesNetwork: false;
    startsDaemonOrAutonomy: false;
    publishesOrTags: false;
  };
  package: {
    name: string;
    version: string;
    versionUnchangedExpected: boolean;
    main: string | null;
    bins: Record<string, string>;
    packagedDocs: string[];
    scriptCount: number;
  };
  readiness: {
    ready: boolean;
    readyCount: number;
    warningCount: number;
    blockedCount: number;
    criticalBlockedCount: number;
  };
  checks: ProductionReadinessCheck[];
  priorityBlockers: ProductionReadinessCheck[];
  installableNow: {
    repoDevCli: boolean;
    builtBinCandidate: boolean;
    mcpStdioCandidate: boolean;
    npmPublishReady: false;
  };
  explicitOutOfScope: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
}

function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

function packagePath(root: string, path: string): string {
  return join(root, ...path.split('/'));
}

function readPackageJson(root: string): PackageJson {
  return JSON.parse(readFileSync(packagePath(root, 'package.json'), 'utf-8')) as PackageJson;
}

function packageFileIncludes(files: string[], path: string): boolean {
  return files.includes(path);
}

function check(id: string, status: ProductionReadinessStatus, impact: ProductionReadinessCheck['impact'], summary: string, evidence: string[], nextStep?: string): ProductionReadinessCheck {
  return { id, status, impact, summary, evidence, nextStep };
}

export function buildProductionReadinessReport(): ProductionReadinessReport {
  const root = packageRoot();
  const packageJson = readPackageJson(root);
  const scripts = packageJson.scripts ?? {};
  const files = packageJson.files ?? [];
  const bins = packageJson.bin ?? {};
  const coverage = analyzePackageScriptCoverage(Object.keys(scripts));

  const requiredDocs = [
    'docs/packaging-install.md',
    'docs/RUNBOOK.md',
    'docs/cli-usage.md',
    'docs/release-candidate-dry-run-checklist.md',
    'docs/policy/README.md',
  ];
  const missingDocs = requiredDocs.filter((doc) => !packageFileIncludes(files, doc));
  const requiredScripts = ['build', 'check:fast', 'check', 'release:readiness', 'bin:smoke', 'mcp:bin-smoke'];
  const missingScripts = requiredScripts.filter((script) => !scripts[script]);
  const forbiddenPackEntries = files.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower === '.env'
      || lower.startsWith('.env')
      || lower === '.nova/'
      || lower.startsWith('.nova')
      || lower === 'src/'
      || lower.startsWith('src/')
      || lower === 'node_modules/'
      || lower.startsWith('node_modules');
  });

  const checks: ProductionReadinessCheck[] = [
    check(
      'version-pinned',
      packageJson.version === '0.1.0' ? 'ready' : 'blocked',
      'critical',
      'Package version remains pinned unless an explicit release/version GO is given.',
      [`package.json version=${packageJson.version ?? '<missing>'}`],
      packageJson.version === '0.1.0' ? undefined : 'Restore package.json version to 0.1.0 or obtain explicit version-change authorization.',
    ),
    check(
      'cli-bin-entrypoint',
      bins.nova === './bin/nova.js' && existsSync(packagePath(root, 'bin/nova.js')) ? 'ready' : 'blocked',
      'critical',
      'Installable CLI bin entrypoint is declared and present.',
      [`bin.nova=${bins.nova ?? '<missing>'}`, `bin/nova.js present=${existsSync(packagePath(root, 'bin/nova.js'))}`],
      'Restore bin.nova to ./bin/nova.js and keep the wrapper present.',
    ),
    check(
      'mcp-stdio-bin-entrypoint',
      bins['nova-mcp'] === './bin/nova-mcp.js' && existsSync(packagePath(root, 'bin/nova-mcp.js')) ? 'ready' : 'blocked',
      'high',
      'Packaged MCP stdio bin entrypoint is declared and present; no HTTP transport is implied.',
      [`bin.nova-mcp=${bins['nova-mcp'] ?? '<missing>'}`, `bin/nova-mcp.js present=${existsSync(packagePath(root, 'bin/nova-mcp.js'))}`],
      'Restore bin.nova-mcp to ./bin/nova-mcp.js and keep stdio-only wrapper behavior.',
    ),
    check(
      'package-main-build-target',
      packageJson.main === 'dist/index.js' ? 'ready' : 'blocked',
      'high',
      'Package main points to the build output used by installable consumers.',
      [`main=${packageJson.main ?? '<missing>'}`],
      'Set package.json main to dist/index.js.',
    ),
    check(
      'required-validation-scripts',
      missingScripts.length === 0 ? 'ready' : 'blocked',
      'critical',
      'Production/install readiness has repeatable local validation scripts.',
      missingScripts.length === 0 ? requiredScripts.map((script) => `${script}=present`) : missingScripts.map((script) => `${script}=missing`),
      'Restore missing package scripts before treating the package as installable.',
    ),
    check(
      'package-script-coverage',
      coverage.missingScripts.length === 0 && coverage.unknownMatrixIds.length === 0 ? 'ready' : 'blocked',
      'high',
      'Every package script has an explicit security/read-only matrix classification.',
      [`covered=${coverage.coveredScripts}/${coverage.totalScripts}`, `missing=${coverage.missingScripts.join(',') || 'none'}`, `unknownMatrixIds=${coverage.unknownMatrixIds.join(',') || 'none'}`],
      'Update read_only_matrix packageScriptCoverage for any script additions.',
    ),
    check(
      'packaged-docs',
      missingDocs.length === 0 ? 'ready' : 'blocked',
      'high',
      'Packaged artifact includes operator/user docs needed to install, validate, and operate safely.',
      missingDocs.length === 0 ? requiredDocs.map((doc) => `${doc}=included`) : missingDocs.map((doc) => `${doc}=missing`),
      'Include missing docs in package.json files or update docs strategy.',
    ),
    check(
      'package-surface-slim',
      forbiddenPackEntries.length === 0 ? 'ready' : 'blocked',
      'critical',
      'Declared package file allowlist excludes source-only and sensitive local state paths.',
      forbiddenPackEntries.length === 0 ? ['no forbidden entries declared in package.json files'] : forbiddenPackEntries,
      'Remove forbidden entries from package.json files and rerun release readiness.',
    ),
    check(
      'release-manifest-gate',
      scripts['release:readiness'] === 'node scripts/assert-release-readiness.mjs' && existsSync(packagePath(root, 'scripts/assert-release-readiness.mjs')) ? 'ready' : 'blocked',
      'critical',
      'Release readiness gate exists as a dry-run manifest check and does not publish/tag/release.',
      [`script=${scripts['release:readiness'] ?? '<missing>'}`, `script file present=${existsSync(packagePath(root, 'scripts/assert-release-readiness.mjs'))}`],
      'Restore release:readiness to the local dry-run manifest checker.',
    ),
    check(
      'dist-build-candidate',
      existsSync(packagePath(root, 'dist/index.js')) ? 'ready' : 'warning',
      'medium',
      'Built package candidate needs dist/index.js; source checkout can rebuild it with npm run build.',
      [`dist/index.js present=${existsSync(packagePath(root, 'dist/index.js'))}`],
      'Run npm run build before a release-candidate manifest check or install rehearsal.',
    ),
    check(
      'publish-release-blocked',
      'blocked',
      'critical',
      'npm publish, git tags, public release, PR creation, and live release network mutation remain intentionally blocked until explicit GO.',
      ['publish=false', 'tag=false', 'release=false', 'pr=false'],
      'Ask for explicit operator GO before any external release action.',
    ),
    check(
      'live-provider-blocked',
      'blocked',
      'critical',
      'Live provider/LLM calls are not required for install readiness and remain blocked without explicit provider/budget/prompt authorization.',
      ['providerCalls=false', 'networkLiveSmoke=false', 'LLM_API_KEY not required for readiness commands'],
      'Use offline diagnostics first; request explicit live-smoke authorization separately if needed.',
    ),
    check(
      'autonomy-daemon-blocked',
      'blocked',
      'critical',
      'Daemon/autonomous execution/write-shell/stateful live paths are intentionally not part of install readiness.',
      ['daemon=false', 'autonomy=false', 'write/shell live gates remain opt-in'],
      'Keep production install readiness separate from autonomous execution enablement.',
    ),
  ];

  const activeBlockers = checks.filter((item) => item.status === 'blocked' && !['publish-release-blocked', 'live-provider-blocked', 'autonomy-daemon-blocked'].includes(item.id));
  const intentionalPolicyBlockers = checks.filter((item) => item.status === 'blocked' && ['publish-release-blocked', 'live-provider-blocked', 'autonomy-daemon-blocked'].includes(item.id));
  const warnings = checks.filter((item) => item.status === 'warning');
  const readyChecks = checks.filter((item) => item.status === 'ready');
  const criticalBlockedCount = activeBlockers.filter((item) => item.impact === 'critical').length;

  return {
    schemaVersion: 1,
    name: 'production-install-readiness-v1',
    mode: 'offline-static',
    safety: {
      offlineOnly: true,
      readsEnv: false,
      readsSecrets: false,
      readsRawNovaArtifacts: false,
      invokesProviders: false,
      invokesTools: false,
      usesNetwork: false,
      startsDaemonOrAutonomy: false,
      publishesOrTags: false,
    },
    package: {
      name: packageJson.name ?? '<missing>',
      version: packageJson.version ?? '<missing>',
      versionUnchangedExpected: true,
      main: packageJson.main ?? null,
      bins,
      packagedDocs: files.filter((entry) => entry.startsWith('docs/') || entry === 'CHANGELOG.md').sort(),
      scriptCount: Object.keys(scripts).length,
    },
    readiness: {
      ready: activeBlockers.length === 0,
      readyCount: readyChecks.length,
      warningCount: warnings.length,
      blockedCount: activeBlockers.length,
      criticalBlockedCount,
    },
    checks,
    priorityBlockers: [...activeBlockers, ...warnings].sort((a, b) => impactRank(a.impact) - impactRank(b.impact)),
    installableNow: {
      repoDevCli: bins.nova === './bin/nova.js' && existsSync(packagePath(root, 'bin/nova.js')),
      builtBinCandidate: bins.nova === './bin/nova.js' && existsSync(packagePath(root, 'bin/nova.js')) && existsSync(packagePath(root, 'dist/index.js')),
      mcpStdioCandidate: bins['nova-mcp'] === './bin/nova-mcp.js' && existsSync(packagePath(root, 'bin/nova-mcp.js')),
      npmPublishReady: false,
    },
    explicitOutOfScope: intentionalPolicyBlockers.map((item) => item.summary),
  };
}

function impactRank(impact: ProductionReadinessCheck['impact']): number {
  switch (impact) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
  }
}
