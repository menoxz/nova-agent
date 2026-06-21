/**
 * Conservative redaction/truncation helpers for traces and eval reports.
 * Re-exported from the shared policy core to keep trace redaction harmonized.
 */

export { errorToSafeObject, redactString, redactUnknown, type RedactionOptions } from '../policy/redact.js';
