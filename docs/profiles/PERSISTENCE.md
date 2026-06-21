# Profile Persistence

Built-in profiles are versioned in source code under `src/profiles/defaults.ts` and indexed through sanitized catalogue metadata.

Custom local profiles are reserved for `.nova/profiles/custom/*.json`. The helper loader validates schema, migrates missing schema version placeholders, rejects secret-like material, and only returns complete `AgentProfile` objects. Custom profiles are local runtime configuration and should not contain credentials.

Stable hashes use canonical JSON with trace fields excluded, so the fingerprint represents profile behavior rather than runtime attribution.
