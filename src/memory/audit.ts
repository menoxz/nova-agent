import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { auditPath } from './paths.js';
import { MEMORY_SCHEMA_VERSION, type MemoryAuditEvent } from './types.js';

export async function appendMemoryAudit(root: string, event: Omit<MemoryAuditEvent, 'schemaVersion' | 'id' | 'timestamp'>): Promise<void> {
  const safe: MemoryAuditEvent = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    id: `maud_${randomUUID()}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  const path = auditPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(safe)}\n`, 'utf-8');
}
