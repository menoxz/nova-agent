import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { containsPrivateKeyMaterial, redactString } from '../policy/redact.js';
import { resolvePolicyPath } from '../policy/path.js';
import type { ScopedContext } from './types.js';

export interface BuildScopedContextOptions {
  root?: string;
  allowlist: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

export async function buildScopedContext(options: BuildScopedContextOptions): Promise<ScopedContext> {
  const root = resolve(options.root ?? process.cwd());
  const caps = {
    maxFiles: options.maxFiles ?? 20,
    maxBytesPerFile: options.maxBytesPerFile ?? 32_000,
    maxTotalBytes: options.maxTotalBytes ?? 120_000,
  };
  const context: ScopedContext = { root, resources: [], omissions: [], caps };
  let total = 0;

  for (const requested of options.allowlist.slice(0, caps.maxFiles)) {
    const inputPath = isAbsolute(requested) ? requested : resolve(root, requested);
    const checked = resolvePolicyPath(inputPath, 'sub-agent context resource', [root]);
    if (!checked.ok) {
      context.omissions.push({ resource: requested, reason: checked.reason });
      continue;
    }
    try {
      const info = await stat(checked.path);
      if (!info.isFile()) {
        context.omissions.push({ resource: requested, reason: 'not a file' });
        continue;
      }
      if (total >= caps.maxTotalBytes) {
        context.omissions.push({ resource: requested, reason: 'total context cap reached' });
        continue;
      }
      const raw = await readFile(checked.path, 'utf-8');
      if (containsPrivateKeyMaterial(raw)) {
        context.omissions.push({ resource: requested, reason: 'private key material detected' });
        continue;
      }
      const budget = Math.min(caps.maxBytesPerFile, caps.maxTotalBytes - total);
      const content = redactString(raw.slice(0, budget), budget);
      total += content.length;
      context.resources.push({
        requested,
        resolved: checked.path,
        safePath: checked.safePath,
        content,
        bytes: Math.min(raw.length, budget),
        omittedBytes: Math.max(0, raw.length - budget),
        redacted: content !== raw.slice(0, budget),
      });
    } catch (err) {
      context.omissions.push({ resource: requested, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (options.allowlist.length > caps.maxFiles) {
    context.omissions.push({ resource: '*', reason: `file count cap reached (${caps.maxFiles})` });
  }
  return context;
}
