# LSP V1 Security

Nova LSP V1 is metadata-only and read-only.

## Path policy

- Allowed roots: project root plus optional `NOVA_LSP_ALLOWED_ROOTS` entries.
- Denied: path traversal, NUL bytes, outside-root paths, `.env`, `.git`, `node_modules`, raw `.nova/traces`, `.nova/evals`, `.nova/reports`, private key extensions, and secret-like filenames.
- Errors are sanitized and do not disclose configured root lists.

## Content policy

- Metadata readers skip binary or oversized files.
- Private-key material is refused.
- Secret-like values are redacted.
- Outputs are capped and marked as truncated when needed.
- LSP trace/log metadata, if added later, must be sanitized and must not include document content.

## Command policy

All V1 `workspace/executeCommand` entries are read-only metadata commands. No shell, write, mutation, or self-rewrite command is registered.
