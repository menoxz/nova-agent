# Runtime Resolution

Resolution order:

1. CLI `--profile <id>` when supported by the entrypoint/eval runner.
2. `NOVA_PROFILE` environment variable.
3. Default `nova.general`.

Resolved profile data is applied to `AgentConfig` without breaking existing config:

- `profile` metadata is attached to the config.
- profile prompt block is prepended to the existing system prompt.
- `maxSteps` defaults from the profile when not already set.
- policy profile defaults from the profile unless config already specifies one.
- tool constraints are attached and enforced by `ToolRegistry` conversion.
- trace config receives profile attribution.
- eval reports include profile metadata while keeping the report schema backward-compatible.
