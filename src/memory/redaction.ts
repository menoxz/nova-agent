const SECRET_KEY_RE = /(?:api[_-]?key|token|password|passwd|secret|private[_-]?key|credential|cookie|authorization)\s*[:=]/i;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const CREDENTIAL_URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s@]+@/i;
const TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/;
const HIGH_ENTROPY_RE = /\b[A-Za-z0-9+/=_-]{48,}\b/;
const RAW_ARTIFACT_RE = /\.nova[\\/](?:traces|evals|reports)(?:[\\/]|$)|(?:^|[\\/"'])\.env(?:\.|["']|$)|(?:^|[\\/"'])\.git(?:[\\/"']|$)|(?:^|[\\/"'])node_modules(?:[\\/"']|$)/i;
const INJECTION_RE = /ignore (?:all )?(?:previous|prior|above|system|developer|safety) instructions|forget (?:the|all|previous|prior|above) instructions|disregard (?:the )?(?:previous|prior|above|system|developer) instructions|(?:system|developer|assistant) prompt|reveal (?:secrets|hidden|system prompt|developer message)|exfiltrate|disable (?:policy|safety|guardrails|filters)|bypass (?:policy|safety|guardrails|filters)|override (?:policy|safety|instructions)|you are now|act as (?:dan|developer mode|system)|jailbreak/i;

export function containsSecretLike(value: unknown): boolean {
  const text = stringify(value);
  return SECRET_KEY_RE.test(text) || PRIVATE_KEY_RE.test(text) || CREDENTIAL_URL_RE.test(text) || TOKEN_RE.test(text) || HIGH_ENTROPY_RE.test(text);
}

export function containsRawArtifactReference(value: unknown): boolean {
  return RAW_ARTIFACT_RE.test(stringify(value));
}

export function injectionRisk(value: unknown): 'none' | 'low' | 'medium' | 'high' {
  const text = stringify(value);
  if (!INJECTION_RE.test(text)) return 'none';
  if (/disable (?:policy|safety|guardrails|filters)|bypass (?:policy|safety|guardrails|filters)|exfiltrate|reveal (?:secrets|hidden|system prompt|developer message)|jailbreak/i.test(text)) return 'high';
  return 'medium';
}

export function redactMemoryText(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const replace = (input: string, re: RegExp) => input.replace(re, () => {
    redacted = true;
    return '[REDACTED]';
  });
  let output = text;
  output = replace(output, CREDENTIAL_URL_RE);
  output = replace(output, TOKEN_RE);
  output = replace(output, PRIVATE_KEY_RE);
  output = output.replace(SECRET_KEY_RE, (match) => {
    redacted = true;
    return `${match.split(/[:=]/)[0]}=[REDACTED]`;
  });
  return { text: output, redacted };
}

export function redactMemoryContent<T extends { title: string; summary: string; body?: string; tags: string[] }>(content: T): { content: T; redacted: boolean } {
  const title = redactMemoryText(content.title);
  const summary = redactMemoryText(content.summary);
  const body = content.body === undefined ? undefined : redactMemoryText(content.body);
  return {
    content: { ...content, title: title.text, summary: summary.text, body: body?.text } as T,
    redacted: title.redacted || summary.redacted || Boolean(body?.redacted),
  };
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
