# Release Decision Gate — nova-agent v0.1.0

| Field | Value |
|---|---|
| Package | `nova-agent` |
| Target version | `0.1.0` |
| Decision date | 2026-06-22 |
| HEAD commit | `9c59680` — `docs(release): add v0.1.0 changelog and release notes` |
| HEAD (full) | `9c5968023a92ab6a68e46ce1fbd49c56600e54dd` |
| Worktree | clean before this doc |
| Existing git tags | none |
| Decision type | Consolidated GO/NO-GO gate (read-only; no release action executed) |

---

## 1. Summary verdict

> ## ✅ RELEASE DECISION: GO

All 10 re-verification checks were re-run from a clean worktree at HEAD `9c59680` and
**every check exited 0 and matched its expected outcome**. Typecheck is clean, the release
readiness manifest passes (348 package entries), the read-only security audit and smoke both
pass with the expected counts, production dependencies report **0 vulnerabilities**, the
packed tarball ships `CHANGELOG.md` and the required runtime files with **no secrets, no
`src/`, no `.env`, and no `.nova/`**, and the built CLI reports `nova-agent 0.1.0`.

The only open items are **P2/P3 cosmetic and hardening advisories** — none of which block the
release (see §4). The release is therefore **approved to publish by the human operator** using
the runbook in §6.

**What would flip this to NO-GO:** any of the following appearing on a fresh re-run before
publish — a non-zero exit from `npm run release:readiness`, `npm run typecheck`, or the
`security:readonly-*` scripts; a packed tarball that includes `src/`, `.env`, `.nova/`, or any
credential; `npm audit --omit=dev` reporting a High/Critical production vulnerability; a
`package.json` version drift away from `0.1.0`; or a pre-existing `v0.1.0` tag indicating the
version was already shipped.

---

## 2. Evidence table

All commands were executed in `C:\jeanluc\nova-agent` on 2026-06-22 at HEAD `9c59680`.
Every number below is copied from live command output — none are assumed or carried over from
prior gates.

| # | Gate criterion | Command | Exit | Result (1-line) |
|---|---|---|---|---|
| 1a | Worktree clean | `git status --porcelain` | 0 | Empty output — no uncommitted changes |
| 1b | Recent history sane | `git log --oneline -5` | 0 | HEAD `9c59680 docs(release): add v0.1.0 changelog and release notes` (then `a142eaf`, `a7de714`, `5c2fa17`, `d0856d8`) |
| 2 | Package version | `node -p "require('./package.json').version"` | 0 | `0.1.0` |
| 3 | No tags exist | `git tag -l` | 0 | Empty output — zero tags |
| 4 | Type safety | `npm run typecheck` | 0 | `tsc --noEmit` clean, no errors |
| 5 | Release readiness | `npm run release:readiness` | 0 | `Release readiness manifest check passed (348 package entries)` |
| 6 | Read-only security audit | `npm run security:readonly-audit` | 0 | `passed entries=53 pureReadOnly=24 dangerousOrMutating=22` |
| 7 | Read-only security smoke | `npm run security:readonly-smoke` | 0 | `passed entries=53` |
| 8 | Production dep audit | `npm audit --omit=dev` | 0 | `found 0 vulnerabilities` |
| 9 | Pack surface | `npm pack --dry-run --ignore-scripts --json` | 0 | 348 files; `nova-agent-0.1.0.tgz`; `CHANGELOG.md` shipped; no `src/`/`.env`/`.nova`/`node_modules`/`tmp`/`.vscode` (see §3) |
| 10 | CLI entrypoint | `node bin/nova.js --version` | 0 | Prints `nova-agent 0.1.0` |

**Aggregate:** 10/10 checks pass, all exit 0, all consistent with expected prior-gate outcomes.

---

## 3. Pack surface detail (criterion #9)

Parsed from `npm pack --dry-run --ignore-scripts --json`:

| Property | Value |
|---|---|
| Tarball name | `nova-agent-0.1.0.tgz` |
| File entry count | 348 |
| Packed size | 264,838 bytes (~259 KB) |
| Unpacked size | 1,116,900 bytes (~1.06 MB) |

Inclusion / exclusion checks (all from the parsed file list):

| Check | Expected | Actual |
|---|---|---|
| `CHANGELOG.md` shipped | yes | ✅ true |
| `dist/index.js` shipped | yes | ✅ true |
| `bin/nova.js` shipped | yes | ✅ true |
| `scripts/assert-release-readiness.mjs` shipped | yes | ✅ true |
| `soul.md` shipped | yes | ✅ true |
| any `src/` entry | no | ✅ false |
| any `.env` entry | no | ✅ false |
| any `.nova` entry | no | ✅ false |
| any `node_modules` entry | no | ✅ false |
| any `tmp/` entry | no | ✅ false |
| any `.vscode` entry | no | ✅ false |
| any `dist/**/*smoke*.js` entry | no | ✅ false |

The packed surface is driven by the explicit `files` allowlist in `package.json` plus its
negated `!dist/**/*smoke*` globs, which is why no source or secret material can leak even
though those paths exist on disk.

---

## 4. Residual risks (P2 / P3 — all non-blocking)

| ID | Severity | Item | Rationale for non-blocking |
|---|---|---|---|
| R1 | P2/P3 | `nova config show` echoes the raw `project` field value | The blocking P1 (a `.env` secret leak in `config show`) was already fixed in commit `a142eaf` — _"fix(cli): load .env before config show"_. The `project` field is a non-secret configuration label; echoing it is cosmetic. No credential is exposed. |
| R2 | P3 | `.gitignore` has no explicit key/cert patterns (`*.pem`, `*.key`, `*.crt`, `*.p12`) | `.gitignore` already covers `.env`, `.env.*`, `.nova/`, `node_modules/`, `dist/`, `tmp/`, logs and editor noise. No key/cert files exist in the repo or the packed tarball (the pack uses a `files` allowlist — verified 0 leaks in §3). This is forward-looking hardening only, not a current exposure. |
| R3 | P3 | Minor CLI cosmetics from the QA journey (formatting/wording) | Non-functional output polish. No command behavior, exit code, or safety property is affected. |
| R4 | P3 | `.pytest_cache/` present in the working directory | The directory is self-ignored by pytest's auto-generated `.pytest_cache/.gitignore` (contents: `*`), so it never appears in `git status --porcelain` (verified empty) and never enters the npm pack (verified absent from the 348-file list). Local-only test artifact. |

No P0, P1, or P2 _blocking_ issues remain open. The security audit posture is **GO** with only
P3 hardening advisories.

---

## 5. Scope boundaries (what v0.1.0 deliberately does NOT do)

This is the initial local, safety-first product baseline. As declared in `CHANGELOG.md` §0.1.0,
the following are **explicitly out of scope** for this release and must not be assumed working:

- **No provider live calls** — provider/model smoke checks are offline/static by design; no
  network LLM calls are part of the shipped, tested surface.
- **No daemon / background autonomy** — there is no long-running background agent or autonomy loop.
- **No remote push, npm publish, or git tag as part of the gate** — all release-side mutations
  are operator-gated and are listed (but not executed) in §6.
- **No provider/model auto-switching** — provider selection is explicit; there is no hidden
  fallback or silent model switching.

Read-only-friendly defaults are the intended posture for v0.1.0.

---

## 6. Publish runbook — ⚠️ DO NOT auto-run — operator action required

**None of the commands below were executed by this gate.** This gate is read-only with respect
to release actions. The sequence is provided for the human operator to run manually after
reviewing this document. Run from `C:\jeanluc\nova-agent` on a clean worktree at HEAD `9c59680`.

Effect-class legend: **[local]** = no external/irreversible effect · **[local-tag]** =
local-only, easily reversible · **[remote-irreversible]** = publishes/pushes to a remote and is
hard or impossible to undo.

```sh
# --- Pre-flight (read-only verification) ---
npm run check            # [local] full smoke + eval suite (or: npm run check:fast for the fast path)
npm run release:readiness  # [local] re-confirm 348-entry manifest, exit 0 expected

# --- Decide visibility BEFORE publishing ---
# Choose public vs private. `--access public` makes the package world-visible and
# (effectively) permanent. If this should be private, do NOT use --access public.

# --- Tag the release (local only) ---
git tag -a v0.1.0 -m "nova-agent v0.1.0"   # [local-tag] creates an annotated local tag

# --- Publish dry-run (no remote effect) ---
npm publish --dry-run                       # [local] simulates publish, prints the tarball contents

# --- Publish for real (IRREVERSIBLE) ---
npm publish --access public                 # [remote-irreversible] requires npm auth (npm login / token);
                                            #   uploads nova-agent-0.1.0.tgz to the npm registry

# --- Push the tag to the remote ---
git push origin v0.1.0                      # [remote] publishes the tag to origin
```

Operator notes:
- `npm publish` requires valid npm authentication (`npm login` or a configured token). This gate
  intentionally does **not** handle credentials.
- Confirm the **public vs private** decision before `npm publish --access public` — for a scoped
  or private package the flags differ.
- `prepack` runs `npm run build` automatically on publish/pack, so `dist/` is rebuilt from
  source at publish time.
- Run the steps in order; do not skip the `--dry-run` before the real publish.

---

## 7. Rollback notes

| Action | Command | Reversibility |
|---|---|---|
| Delete a mistaken **local** tag | `git tag -d v0.1.0` | Fully reversible while the tag is local-only (before any `git push origin v0.1.0`). |
| Delete a tag already pushed to remote | `git push origin :refs/tags/v0.1.0` (or `git push --delete origin v0.1.0`) | Possible, but anyone who already fetched the tag keeps it; coordinate with consumers. |
| Undo an **npm publish** | _Not generally possible._ | `npm unpublish` is **restricted**: npm only permits unpublishing within a short window (72h) and under policy constraints, and a republish of the same version is blocked. Treat `npm publish` as **irreversible** — get the publish decision right before running it. |

Recommended safe recovery if a tag was created but **nothing was published or pushed**:
`git tag -d v0.1.0` restores the pre-tag state with no remote impact.

---

## 8. Gate sign-off

- **Verdict:** GO — approved for operator-driven publish.
- **Evidence basis:** 10/10 re-verification checks re-run live at HEAD `9c59680`, all exit 0,
  all matching expected prior-gate outcomes (§2, §3).
- **Blocking issues:** none (0 × P0/P1/P2).
- **Open advisories:** 4 × P3-class, non-blocking (§4).
- **This document is read-only:** no tag, publish, push, or commit was performed by this gate.

> **RELEASE DECISION: GO**
