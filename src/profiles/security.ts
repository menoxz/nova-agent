const SECRET_KEY_PATTERN = /^(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|access[_-]?key|refresh[_-]?token)$/i;
const SECRET_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,})/;

export function containsSecretLikeMaterial(value: unknown): boolean {
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsSecretLikeMaterial);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) return true;
      if (containsSecretLikeMaterial(child)) return true;
    }
  }
  return false;
}

export function assertNoProfileSecrets(value: unknown, label = 'profile'): void {
  if (containsSecretLikeMaterial(value)) throw new Error(`${label} contains secret-like material and was rejected`);
}
