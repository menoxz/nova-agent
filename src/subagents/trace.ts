import { randomUUID } from 'node:crypto';
import { redactUnknown } from '../policy/redact.js';
import type { ActorContext } from '../policy/types.js';
import type { SubagentLifecycleEvent, SubagentRoleId } from './types.js';

export class SubagentTraceRecorder {
  private readonly events: SubagentLifecycleEvent[] = [];

  record(input: Omit<SubagentLifecycleEvent, 'id' | 'timestamp'>): SubagentLifecycleEvent {
    const event: SubagentLifecycleEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
      safeMetadata: input.safeMetadata ? redactUnknown(input.safeMetadata, { includeContent: true, maxChars: 500 }) as Record<string, unknown> : undefined,
    };
    this.events.push(event);
    return event;
  }

  lifecycle(type: SubagentLifecycleEvent['type'], actor: ActorContext, details: { delegationId?: string; taskId?: string; role?: SubagentRoleId; reason?: string; safeMetadata?: Record<string, unknown> } = {}): SubagentLifecycleEvent {
    return this.record({ type, actor, ...details });
  }

  snapshot(): SubagentLifecycleEvent[] {
    return structuredClone(this.events);
  }
}
