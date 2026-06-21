import type { RuntimeEventSeverity, RuntimeEventSource, RuntimeStreamingEvent, StreamingEventPayload } from './types.js';

export interface RuntimeEventContext {
  sessionId?: string;
  runId?: string;
}

export interface RuntimeEventEnvelopeOptions extends RuntimeEventContext {
  source?: RuntimeEventSource;
  severity?: RuntimeEventSeverity;
}

export class RuntimeEventEmitter {
  private sequence = 0;

  constructor(private readonly context: RuntimeEventContext = {}) {}

  create(payload: StreamingEventPayload, options: RuntimeEventEnvelopeOptions = {}): RuntimeStreamingEvent {
    const sequence = ++this.sequence;
    return {
      schemaVersion: 1,
      eventId: `evt_${Date.now().toString(36)}_${sequence.toString(36)}`,
      sequence,
      timestamp: new Date().toISOString(),
      source: options.source ?? inferSource(payload.type),
      severity: options.severity ?? inferSeverity(payload.type),
      sessionId: options.sessionId ?? this.context.sessionId,
      runId: options.runId ?? this.context.runId,
      ...payload,
    };
  }
}

export function createRuntimeEvent(payload: StreamingEventPayload, options?: RuntimeEventEnvelopeOptions): RuntimeStreamingEvent {
  return new RuntimeEventEmitter(options).create(payload, options);
}

function inferSource(type: StreamingEventPayload['type']): RuntimeEventSource {
  if (type.startsWith('tool_')) return 'tool';
  if (type === 'token' || type.startsWith('reasoning_')) return 'llm';
  return 'runtime';
}

function inferSeverity(type: StreamingEventPayload['type']): RuntimeEventSeverity {
  if (type === 'error') return 'error';
  if (type === 'metrics') return 'debug';
  return 'info';
}
