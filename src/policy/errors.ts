import { redactString } from './redact.js';

export const DENIED_MESSAGE = 'Access denied by Nova policy.';

export class PolicyDeniedError extends Error {
  constructor(message: string) {
    super(redactString(message.replace(/\r?\n[\s\S]*/m, ''), 1_000));
    this.name = 'PolicyDeniedError';
  }
}

export function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redactString(message.replace(/\r?\n[\s\S]*/m, ''), 1_000);
}
