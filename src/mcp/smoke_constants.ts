import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT_PLACEHOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
