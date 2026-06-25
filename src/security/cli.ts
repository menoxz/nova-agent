import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePackageScriptCoverage, isDangerousOrMutating, isPureReadOnly, packageScriptCoverage, readOnlySafetyMatrix } from './read_only_matrix.js';

function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

function readNovaPackageJson(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf-8')) as { scripts?: Record<string, string> };
}

export async function handleSecurityCommand(args: string[]): Promise<boolean> {
  const [area, action, ...rest] = args;
  if (area !== 'security') return false;

  if (action === 'matrix' || action === undefined) {
    const classification = option(rest, 'classification');
    const entries = classification
      ? readOnlySafetyMatrix.filter((entry) => entry.classification === classification)
      : [...readOnlySafetyMatrix];
    console.log(JSON.stringify({ count: entries.length, entries }, null, 2));
    return true;
  }

  if (action === 'coverage') {
    const packageJson = readNovaPackageJson();
    const packageScripts = Object.keys(packageJson.scripts ?? {}).sort();
    const report = analyzePackageScriptCoverage(packageScripts);
    const rows = packageScriptCoverage.map((coverage) => ({ ...coverage, scriptCommand: packageJson.scripts?.[coverage.script] ?? null }));
    const ok = report.missingScripts.length === 0 && report.unknownMatrixIds.length === 0;
    console.log(JSON.stringify({ ok, ...report, coverage: rows }, null, 2));
    process.exitCode = ok ? 0 : 1;
    return true;
  }

  if (action === 'doctor') {
    const packageJson = readNovaPackageJson();
    const coverage = analyzePackageScriptCoverage(Object.keys(packageJson.scripts ?? {}));
    const duplicateIds = readOnlySafetyMatrix
      .map((entry) => entry.id)
      .filter((id, index, all) => all.indexOf(id) !== index)
      .sort();
    const liveCompatible = readOnlySafetyMatrix.filter((entry) => isDangerousOrMutating(entry) && entry.orchestratorReadOnlyCompatible).map((entry) => entry.id).sort();
    const pureWithWrites = readOnlySafetyMatrix.filter((entry) => isPureReadOnly(entry) && entry.flags.filesystemWrites !== 'none').map((entry) => entry.id).sort();
    const ok = coverage.missingScripts.length === 0 && coverage.unknownMatrixIds.length === 0 && duplicateIds.length === 0 && liveCompatible.length === 0 && pureWithWrites.length === 0;
    console.log(JSON.stringify({
      ok,
      matrixEntries: readOnlySafetyMatrix.length,
      packageScriptCoverage: coverage,
      duplicateIds,
      liveOrMutatingReadOnlyCompatibleIds: liveCompatible,
      pureReadOnlyWithWritesIds: pureWithWrites,
      safety: { invokesLlm: false, invokesTools: false, readsSecrets: false, writesFiles: false, usesNetwork: false },
    }, null, 2));
    process.exitCode = ok ? 0 : 1;
    return true;
  }

  console.error('Unknown Nova security command. Usage: nova security matrix [--classification <kind>] | nova security coverage | nova security doctor');
  process.exitCode = 1;
  return true;
}

function option(args: string[], name: string): string | undefined {
  const direct = args.indexOf(`--${name}`);
  if (direct >= 0) return args[direct + 1];
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
