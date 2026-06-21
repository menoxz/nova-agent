import { PROFILE_SCHEMA_VERSION } from './types.js';

export function migrateProfile(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = { ...(value as Record<string, unknown>) };
  if (record.schemaVersion === undefined) record.schemaVersion = PROFILE_SCHEMA_VERSION;
  return record;
}
