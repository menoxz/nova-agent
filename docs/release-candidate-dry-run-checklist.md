# Release Candidate Dry-Run Checklist V1

Use this checklist to collect release-candidate evidence without publishing, tagging, pushing, opening PRs, calling live providers, starting autonomy, or inspecting sensitive local artifacts.

## Scope

Allowed scope for this dry-run:

- inspect package metadata, scripts, selected documentation, and generated package manifests;
- run local quality gates that are documented as offline/read-only or mock-only;
- verify release preconditions from repository state and package contents.

Explicitly out of scope unless separately authorized for a different task:

- no `npm publish`, git tag, git push, or PR creation;
- no provider/LLM live calls and no commands requiring real API keys;
- no daemon, scheduler, heartbeat autonomy, or autonomous task execution;
- no reading or editing `.env`, secrets, credentials, prompts, raw `.nova/traces`, raw `.nova/evals`, or raw `.nova/reports`.

## Side-effect classes

Classify every candidate command before running it.

| Class | Meaning | Examples | Dry-run default |
| --- | --- | --- | --- |
| Pure read-only | Reads repository/package metadata and prints output without scripts, artifact writes, installs, network mutation, or sensitive raw artifact access. | `npm pkg get files scripts.prepack scripts.build scripts.check scripts.check:fast`, `npm pack --dry-run --ignore-scripts` | Allowed |
| Read-only-sensitive | Reads local data that may expose secrets, prompts, raw traces, raw evals, or private reports even if it does not write. | opening `.env`, credentials, prompts, raw `.nova/traces`, raw `.nova/evals`, raw `.nova/reports` | Blocked for this checklist |
| Metadata-writing | Writes local diagnostic metadata or summarized reports without changing runtime source. | commands that write sanitized summaries under `tmp/` or approved `.nova/heartbeat` dry-run files | Requires explicit need and path review |
| Artifact-writing | Creates or updates build/package artifacts in the repository or temp directories. | `npm run build`, normal `npm pack`, generated `dist/`, tarballs | Avoid by default; explicit authorization required |
| External/global mutation | Changes npm global state, registry-facing state, system locations, or another project. | `npm link`, `npm install -g`, tarball install into a temp consumer, registry config changes | Explicit authorization required plus cleanup |
| Live-provider | Calls provider/LLM/network services or requires real API keys. | real prompt runs, live provider smoke, non-mock evals against providers | Blocked |
| Dangerous-blocked | Publishes, tags, pushes, creates PRs, deletes state, or runs destructive commands. | `npm publish`, `git tag`, `git push`, PR creation, destructive shell operations | Blocked |

## Pure read-only commands

These commands are the preferred release-candidate dry-run baseline:

```bash
npm pkg get files scripts.prepack scripts.build scripts.check scripts.check:fast
npm run release:readiness
npm run production:smoke
npm pack --dry-run --ignore-scripts
```

`npm pkg get ...` reads selected manifest fields only. `npm run release:readiness` is the repeatable local Release Readiness Gate V1: it runs `npm pack --dry-run --ignore-scripts --json`, verifies required package entries, and rejects forbidden/sensitive entries from the generated manifest. `npm pack --dry-run --ignore-scripts` asks npm to calculate and print package contents while suppressing lifecycle scripts; it must not run `prepack`, must not build `dist`, and must not create a package tarball.

Review the dry-run output for:

- expected `bin/nova.js` wrapper;
- expected `dist/index.js` and other already-built runtime files if a release candidate requires them;
- slim manifest contents: `README.md`, `CHANGELOG.md`, `soul.md`, selected `docs/`, `bin/`, `dist/`, and `scripts/assert-release-readiness.mjs`;
- absence of source-only or sensitive files such as `.env`, prompts, raw `.nova` artifacts, credentials, temporary logs, and unrelated development outputs.

## Why normal `npm pack` is not pure read-only

The package manifest defines:

```json
"prepack": "npm run build",
"build": "tsc"
```

Normal `npm pack` runs lifecycle scripts. In this repository that means `prepack` runs `npm run build`, which writes compiled artifacts under `dist/` before creating a tarball. Because it can modify repository artifacts and write package archives, normal `npm pack` is artifact-writing, not pure read-only. Use `npm pack --dry-run --ignore-scripts` for this checklist unless an artifact-producing release rehearsal is explicitly authorized.

## Release preconditions

Confirm these before treating a candidate as release-ready:

- Git working tree is clean or all local changes are intentional documentation/release-candidate evidence changes.
- `package.json` version matches the intended release version.
- `CHANGELOG.md` contains the intended release notes.
- `dist/index.js` exists for a build-backed package candidate.
- `bin.nova` points to `./bin/nova.js`, and the wrapper supports help/version without requiring `LLM_API_KEY`.
- `files` keeps the package slim: `bin/`, `dist/`, `scripts/assert-release-readiness.mjs`, selected operator/user docs, `CHANGELOG.md`, and `soul.md` only.
- Package docs include the release/operator checklist when it is selected for shipped docs.
- No secrets, credentials, prompts, raw `.nova` traces/evals/reports, or private local artifacts appear in the pack manifest.

## Install simulation options

Install simulations are useful but are not pure read-only. Run them only with explicit authorization, an isolated target, and cleanup notes in evidence.

### Temp-directory tarball install

Class: artifact-writing plus external/global mutation depending on target setup.

Typical authorized flow:

1. create an empty temporary consumer directory outside the repository;
2. create a package tarball from an explicitly approved build/pack step;
3. install the tarball into the temporary consumer;
4. run `nova --help` and `nova --version` without API keys;
5. delete the temporary consumer and tarball.

Side effects: writes a tarball, `package-lock.json`, `node_modules/`, npm cache entries, and temporary project files. Cleanup must remove the temporary consumer and tarball; npm cache changes may remain outside the repository.

### `npm link`

Class: external/global mutation.

Typical authorized flow:

1. from the repository, run `npm link`;
2. optionally from a temporary consumer, run `npm link @lux-tech/nova-agent`;
3. run `nova --help` and `nova --version`;
4. cleanup with `npm unlink` in the consumer and `npm unlink -g @lux-tech/nova-agent` or the platform-equivalent global unlink.

Side effects: changes global npm link state and may affect shell resolution of `nova`. Cleanup commands must be recorded. Do not use `npm link` as part of the pure dry-run checklist.

## Quality gates

Recommended release-candidate gates, all expected to avoid live provider/LLM calls unless future documentation explicitly says otherwise:

```bash
npm run check:fast
npm run check
node bin/nova.js --help
node bin/nova.js --version
npm run security:readonly-audit
npm run security:readonly-smoke
npm run release:readiness
npm pack --dry-run --ignore-scripts
```

For documentation-only checklist updates, a proportional validation subset may be used when requested by the task owner:

```bash
npm run typecheck
npm run security:readonly-audit
npm run security:readonly-smoke
npm pack --dry-run --ignore-scripts
git diff --check
```

If any gate fails, stop the dry-run, keep the evidence, and classify the candidate as blocked until the failure is understood and fixed.

## Evidence template

Copy this template into the task report or release notes.

```markdown
## Release Candidate Dry-Run Evidence

- Candidate version:
- Commit / branch:
- Operator:
- Date/time:
- Scope confirmation:
  - [ ] No publish/tag/push/PR
  - [ ] No live provider/LLM calls
  - [ ] No daemon/autonomy
  - [ ] No secrets/prompts/raw .nova artifacts inspected

### Manifest and packaging

- Command: `npm pkg get files scripts.prepack scripts.build scripts.check scripts.check:fast`
- Exit code:
- Notes:

- Command: `npm pack --dry-run --ignore-scripts`
- Exit code:
- Package contents summary:
- Unexpected files: none / list

- Command: `npm run release:readiness`
- Exit code:
- Notes:

- Command: `npm run production:smoke`
- Exit code:
- Notes:

### Preconditions

- Git clean or intentional diff only:
- Version/CHANGELOG aligned:
- `dist/index.js` present:
- `bin/nova.js` present and mapped by `bin.nova`:
- Slim docs/files confirmed:

### Quality gates

| Command | Exit code | Notes |
| --- | --- | --- |
| `npm run typecheck` |  |  |
| `npm run check:fast` |  |  |
| `npm run check` |  |  |
| `node bin/nova.js --help` |  |  |
| `node bin/nova.js --version` |  |  |
| `npm run security:readonly-audit` |  |  |
| `npm run security:readonly-smoke` |  |  |
| `git diff --check` |  |  |

### Install simulations, if explicitly authorized

- Method: none / temp-dir tarball / npm link
- Authorization reference:
- Side effects observed:
- Cleanup completed:

Validated example evidence for the temp-dir tarball path:

- Method: temp-dir tarball install under an isolated directory outside the repository.
- Commands: `npm run build`, `npm pack --json --pack-destination <temp>`, `npm init -y`, `npm install <tarball> --no-audit --no-fund`, `npx nova --help`, `npx nova --version`, `npx nova production readiness`, `npx nova-mcp --version`.
- Observed: package version `0.1.0`, tarball `lux-tech-nova-agent-0.1.0.tgz`, package entries `408`, production readiness `ready=true`, no active blockers.
- Cleanup: temporary consumer and tarball directory removed (`tempRemoved=true`).
- Live provider: skipped unless `NOVA_ENABLE_LIVE_LLM=1|true` and `LLM_API_KEY` are already present in the process environment; never print credential values.

### Status

- Result: pass / partial / blocked
- Blockers:
- Follow-ups:
```
