import { createHash } from 'node:crypto';
import type { AgentProfile } from './types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => key !== 'trace')
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function stableProfileJson(profile: AgentProfile): string {
  return JSON.stringify(canonicalize(profile));
}

export function hashProfile(profile: AgentProfile): string {
  return createHash('sha256').update(stableProfileJson(profile)).digest('hex');
}
