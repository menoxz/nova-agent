const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|cookie|password|passwd|secret|token|credential|private[_-]?key)/i;

export const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(LLM_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY)\s*=\s*[^\s]+/gi,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/gi,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /((?:api[_-]?key|authorization|password|passwd|secret|token|credential)\s*[:=]\s*)([^\s'\"]+)/gi,
];

export function containsPrivateKeyMaterial(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----/i.test(text);
}

export function redactString(value: string, maxChars = 2_000): string {
  let safe = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    safe = safe.replace(pattern, (...args) => {
      const match = String(args[0] ?? '');
      if (args.length > 3 && typeof args[1] === 'string') return `${args[1]}<redacted>`;
      const [key] = match.split('=');
      return match.includes('=') && key ? `${key}=<redacted>` : '<redacted>';
    });
  }
  if (safe.length > maxChars) return `${safe.slice(0, maxChars)}...(truncated ${safe.length - maxChars} chars)`;
  return safe;
}

export interface RedactionOptions {
  includeContent?: boolean;
  maxChars?: number;
  maxDepth?: number;
  maxArrayItems?: number;
}

export function redactUnknown(value: unknown, options: RedactionOptions = {}, depth = 0): unknown {
  const includeContent = options.includeContent ?? true;
  const maxChars = options.maxChars ?? 2_000;
  const maxDepth = options.maxDepth ?? 6;
  const maxArrayItems = options.maxArrayItems ?? 25;
  if (!includeContent) return '<content omitted>';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value, maxChars);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `<${typeof value}>`;
  if (depth >= maxDepth) return '<max depth reached>';
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArrayItems).map((item) => redactUnknown(item, options, depth + 1));
    if (value.length > maxArrayItems) items.push(`...(truncated ${value.length - maxArrayItems} items)`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '<redacted>' : redactUnknown(item, options, depth + 1);
  }
  return out;
}

export function errorToSafeObject(err: unknown): { message: string; name?: string; stack?: string } {
  if (err instanceof Error) {
    return { message: redactString(err.message, 1_000), name: err.name, stack: err.stack ? redactString(err.stack, 4_000) : undefined };
  }
  return { message: redactString(String(err), 1_000) };
}
