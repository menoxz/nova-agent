# Nova Agent

Nova Agent is a local-first, general-purpose AI agent CLI with provider profiles, safe tool orchestration, streaming output, batch runs, local runtime metadata, and read-only release diagnostics.

This repository is the source package for the `nova` command. The V1 release hardening focus is predictable CLI UX: help, version, config inspection, provider catalog inspection, eval report reading, heartbeat planning, and batch dry-runs are safe to run without an LLM API key.

## Quick start

From the repository:

```bash
npm install
node --import tsx src/index.ts --help
node --import tsx src/index.ts --version
node --import tsx src/index.ts providers list
node --import tsx src/index.ts config explain
```

To run a real prompt, configure a provider and API key first:

```bash
cp .env.example .env
# edit .env with LLM_API_KEY and provider settings
node --import tsx src/index.ts --stream "summarize this project"
```

The package binary can be exercised locally after a build, or through the development fallback when `dist/` is absent:

```bash
npm run build
node bin/nova.js --help
node bin/nova.js --version
```

## Safe / read-only CLI paths

These commands do not invoke live providers, do not run tools, and should not require `LLM_API_KEY`:

```bash
node --import tsx src/index.ts --help
node --import tsx src/index.ts --version
node --import tsx src/index.ts help
node --import tsx src/index.ts config --help
node --import tsx src/index.ts config validate
node --import tsx src/index.ts config show
node --import tsx src/index.ts config explain
node --import tsx src/index.ts providers --help
node --import tsx src/index.ts providers list
node --import tsx src/index.ts providers show openmodel-deepseek-v4-flash
node --import tsx src/index.ts batch --help
node --import tsx src/index.ts batch prompts.json --dry-run
node --import tsx src/index.ts heartbeat --help
node --import tsx src/index.ts heartbeat tick --dry-run
node --import tsx src/index.ts eval list
```

`providers doctor` is a diagnostic command: it reports selected provider/base URL/model/API-key presence without making live provider calls or printing secret values.

`batch <file>` without `--dry-run` executes prompts and requires a configured LLM API key. `batch <file> --dry-run` only validates input/filters and writes reports when requested.

## Packaging and install notes

Package metadata lives in `package.json`:

- `bin.nova` points to `bin/nova.js`.
- The packaged file list includes `bin/`, `dist/`, selected docs under `docs/`, `CHANGELOG.md`, and `soul.md`.
- The root `README.md` is included by npm's default packaging rules and is intended for package inspection/readability.

No npm publish, tag, push, PR, or remote release step is part of release-candidate dry-runs. Follow the [Release Candidate Dry-Run Checklist V1](docs/release-candidate-dry-run-checklist.md) and inspect the package locally with the pure read-only command:

```bash
npm pack --dry-run --ignore-scripts
```

Use `npm link` only for explicitly authorized local installation testing when needed; it does not publish to the registry, but it mutates global npm link state and is not part of the pure read-only dry-run.

## Documentation

- [CLI usage](docs/cli-usage.md)
- [Packaging / install UX](docs/packaging-install.md)
- [Release Candidate Dry-Run Checklist V1](docs/release-candidate-dry-run-checklist.md)
- [Runbook](docs/RUNBOOK.md)
- [Policy and read-only command audit](docs/policy/README.md)
- [Provider live smoke readiness plan](docs/provider-live-smoke-readiness.md)
- [Trace and eval notes](docs/TRACE_EVAL.md) (source repository only; not shipped in the npm package)
- [Heartbeat safe slice](docs/heartbeat.md) (source repository only; not shipped in the npm package)
- [Changelog](CHANGELOG.md)

## Validation

Common local checks:

```bash
npm run typecheck
npm run cli:smoke
npm run config:smoke
npm run providers:smoke
npm run providers:readiness-smoke
npm run batch:smoke
npm run security:readonly-audit
npm run security:readonly-smoke
npm run check:fast
```

These checks are designed to avoid live LLM/provider calls unless explicitly documented otherwise.
