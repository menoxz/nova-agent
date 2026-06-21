# Nova Agent Profiles V1

Agent Profiles are persistent, sanitized definitions for specialized Nova agents. They combine identity, objective, model defaults, prompt overlays, runtime limits, tool constraints, policy profile, future memory contract, eval hooks, output contract, trace attribution, and sub-agent compatibility.

## Built-ins

V1 ships nine built-ins: `nova.general`, `nova.researcher`, `nova.architect`, `nova.builder`, `nova.security`, `nova.qa`, `nova.docs`, `nova.refactor`, and `nova.product`.

Use a profile with either:

```bash
NOVA_PROFILE=nova.security npm run dev
npx tsx src/index.ts --profile nova.builder "Inspect this repository"
npm run eval:profiles
```

## Module layout

The foundation lives in `src/profiles/`: types, Zod schema, built-in defaults, catalogue metadata, loader, resolver, merge helpers, hash/fingerprint, validation, migrations, import/export, audit sanitization, security checks, smoke test, and barrel exports.

## Safety defaults

- Built-ins do not allow `write_file` or `bash` by default.
- Tool deny lists win over allow lists.
- The selected agent profile's policy profile is authoritative by default; a caller must set `policy.allowProfilePolicyOverride: true` to replace it explicitly.
- Resolved profile metadata includes the effective `policyProfileId` for trace/audit attribution.
- Profiles V1 applies model environment overrides only when `allowEnvironmentOverride` permits them and the field is not locked. Runtime config overrides such as `maxSteps` are not applied; profile runtime limits remain authoritative.
- Import/export helpers resolve relative paths inside the custom profiles root (or a supplied `rootDir`) and reject traversal or absolute paths outside that root.
- Policy profiles remain authoritative for execution; write/shell/high-risk actions require approval semantics.
- Secret-like profile keys/values are rejected by validation/import/custom loading.
