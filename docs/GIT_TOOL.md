# `git` safe read-only tool

`git` provides safe, structured Git inspection operations for Nova.

It intentionally exposes only read-only operations and does **not** support destructive or network commands such as `commit`, `checkout`, `reset`, `clean`, `push`, `pull`, `fetch`, `merge`, `rebase`, or arbitrary raw Git arguments.

## Supported actions

```ts
action:
  | "status"
  | "diff"
  | "log"
  | "branch"
  | "show"
  | "ls-files"
```

## Common inputs

```ts
{
  action: string;
  cwd?: string;              // must be inside a Git work tree
  timeout?: number;          // default 15000 ms, max 120000 ms
  maxOutputChars?: number;   // default 40000, max 250000
  paths?: string[];          // pathspec filters, passed after --, max 50
}
```

Safety defaults:

- validates `cwd` exists and is a directory
- validates `cwd` is inside a Git work tree before running the selected operation
- disables terminal prompts via `GIT_TERMINAL_PROMPT=0`
- disables pagers/colors via `GIT_PAGER=cat`, `PAGER=cat`, `NO_COLOR=1`, `color.ui=false`, `core.pager=cat`
- uses `spawn` with argv arrays, not shell command interpolation
- kills process tree on timeout or output flood
- caps output size

## Actions

### `status`

Runs:

```text
git status --short --branch --untracked-files=all
```

Example:

```json
{ "action": "status", "cwd": "repo" }
```

### `diff`

Inputs:

```ts
{
  action: "diff";
  staged?: boolean;                  // uses --cached
  diffMode?: "patch" | "stat" | "name-only"; // default patch
  context?: number;                  // patch mode only, default 3, max 20
  revision?: string;                 // optional safe revision/range
  paths?: string[];
}
```

Examples:

```json
{ "action": "diff", "cwd": "repo", "diffMode": "stat" }
```

```json
{ "action": "diff", "cwd": "repo", "staged": true, "diffMode": "name-only" }
```

### `log`

Runs a bounded log with ISO dates and decoration:

```text
git log --max-count=N --date=iso-strict --decorate=short --pretty=format:%h%x09%ad%x09%d%x09%s
```

Inputs:

```ts
{
  action: "log";
  maxCount?: number;   // default 20, max 200
  revision?: string;
  paths?: string[];
}
```

### `branch`

Inputs:

```ts
{
  action: "branch";
  branchMode?: "current" | "list" | "all"; // default list
  verbose?: boolean;
}
```

Examples:

```json
{ "action": "branch", "cwd": "repo", "branchMode": "current" }
```

### `show`

Shows one safe revision, default `HEAD`:

```text
git show --no-ext-diff --no-color --stat --patch --format=fuller <revision>
```

Inputs:

```ts
{
  action: "show";
  revision?: string; // default HEAD
  paths?: string[];
}
```

### `ls-files`

Inputs:

```ts
{
  action: "ls-files";
  lsMode?: "tracked" | "modified" | "deleted" | "others" | "stage" | "all";
  paths?: string[];
}
```

## Revision validation

`revision` is intentionally constrained:

- no whitespace
- no NUL bytes
- must not start with `-`
- max 200 chars
- allowed characters: letters, numbers, `_ . / ~ ^ : @ { } + - =`

This allows common revs/ranges like `HEAD`, `HEAD~1`, `main..HEAD`, `feature/x`, while blocking option injection such as `--help`.

## Output format

Every result includes a structured header:

```text
## Git status
Command: git status --short --branch --untracked-files=all
Repo root: C:/path/repo
Cwd: C:\path\repo
Git dir: .git
Exit code: 0
Duration: 44 ms

## main
 M file.txt
?? new.txt
```

Errors are explicit and include the allowed read-only actions.

## Verification performed

Test repository: `tmp/git-fixture`

Validated:

- `npx tsc --noEmit`
- `status`
- `diff` stat
- `diff` staged name-only
- `log`
- `branch` current
- `show HEAD`
- `ls-files all`
- non-repo `cwd` clear error
- unsafe revision `--help` rejected
- unsupported action `push` refused
