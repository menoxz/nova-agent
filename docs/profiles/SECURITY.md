# Profile Security

Profiles are configuration, not secret storage.

- Import/export and custom loading reject secret-like keys (`apiKey`, `token`, `password`, `privateKey`, etc.) and common secret value formats.
- Catalogue entries expose only sanitized metadata: identity, tags, source, hash, policy profile, mode, and compatible roles.
- Profiles cannot bypass Policy/Permissions V1. They can select a policy profile and constrain tools, but execution still flows through `ToolRegistry` policy checks.
- Denied tools always take precedence over allowed tools.
- Full Memory/Knowledge storage is intentionally out of scope; V1 only records profile memory contracts/scopes.
