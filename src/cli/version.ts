import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type NovaPackageInfo = {
  name: string;
  version: string;
};

const fallbackPackageInfo: NovaPackageInfo = {
  name: 'nova-agent',
  version: '0.0.0-unknown',
};

function packageRoot(): string {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function readNovaPackageInfo(): NovaPackageInfo {
  try {
    const raw = readFileSync(join(packageRoot(), 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NovaPackageInfo>;
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallbackPackageInfo.name,
      version: typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version : fallbackPackageInfo.version,
    };
  } catch {
    return fallbackPackageInfo;
  }
}

export function renderNovaVersion(): string {
  const info = readNovaPackageInfo();
  return `${info.name} ${info.version}`;
}
