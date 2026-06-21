import { MEMORY_SCHEMA_VERSION } from './types.js';

export const MEMORY_MIGRATIONS: string[] = [];

export function migrateMemoryObject<T>(value: T): T {
  // V1 placeholder: future migrations must be explicit and idempotent.
  return value;
}

export function supportedMemorySchemaVersion(version: unknown): boolean {
  return version === MEMORY_SCHEMA_VERSION;
}
