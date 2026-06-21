# `bash` anti-blocking runner

`bash` executes bounded, non-interactive shell commands for Nova.

The tool is intentionally defensive: it refuses common interactive or long-running commands by default, caps runtime and output, validates cwd/env, closes stdin, and kills the process tree on timeout or output flood.

## Shell selection

- Windows: `pwsh.exe` with fallback to `powershell.exe`
- Linux/macOS: `/bin/bash` with fallback to `/bin/sh`

Windows commands run with:

```text
-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>
```

## Inputs

```ts
{
  command: string;
  timeout?: number;        // default 30000 ms, max 300000 ms
  workdir?: string;        // must exist and be a directory
  description?: string;
  stdin?: string;          // piped directly; stdin is closed automatically
  env?: Record<string,string>;
  maxOutputChars?: number; // default 20000, max 200000
  allowLongRunning?: boolean;
}
```

## Anti-blocking behavior

### Timeout

Every command has a timeout. On timeout, Nova kills the full process tree:

- Windows: `taskkill /PID <pid> /T /F`
- Unix: process group `SIGTERM`, then `SIGKILL` after a short grace period

The result includes:

```text
Flags: TIMEOUT_PROCESS_TREE_KILLED
```

### Output limit

Combined stdout+stderr output is capped. If the command exceeds the cap, Nova kills the process tree and returns the captured prefix.

The result includes:

```text
Flags: OUTPUT_LIMIT_PROCESS_TREE_KILLED
```

### Interactive / long-running detection

By default, the tool refuses likely blocking commands, including:

- dev servers: `npm run dev`, `yarn dev`, `vite`, `next dev`, etc.
- web servers: `uvicorn`, `flask run`, `python -m http.server`, etc.
- foreground Docker Compose: `docker compose up` without `-d`
- streaming/interactive commands: `tail -f`, `watch`, `top`, `less`, `more`
- editors: `vim`, `nano`, `emacs`, `code`, `notepad`
- interactive shells/REPLs: bare `python`, `node`, `bash`, `pwsh`, etc.
- password/privilege prompts: `passwd`, `sudo -v`, `sudo -i`, `su`

To intentionally smoke-test one of these commands, pass:

```json
{ "allowLongRunning": true, "timeout": 5000 }
```

Timeout and output limits still apply.

## Safety constraints

- `workdir` is resolved and must already exist as a directory.
- `env` keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- `env` values must be strings and are capped at 8192 characters.
- `stdin` is written to the child process directly, not via shell temp-file interpolation.
- The child stdin is always closed to avoid hidden prompts hanging forever.

## Examples

### Simple command

```json
{ "command": "node -e \"console.log('hello')\"", "timeout": 5000 }
```

### With stdin and env

```json
{
  "command": "node -e \"process.stdin.on('data', d => console.log(process.env.MODE + ':' + d.toString().trim()))\"",
  "stdin": "payload\n",
  "env": { "MODE": "test" },
  "timeout": 5000
}
```

### Bounded smoke test of a long-running command

```json
{
  "command": "npm run dev",
  "allowLongRunning": true,
  "timeout": 5000,
  "maxOutputChars": 20000
}
```

## Verification performed

- TypeScript compile: `npx tsc --noEmit`
- Simple command exits normally.
- `stdin` + `env` + `workdir` works.
- `npm run dev` is refused by default.
- Timeout kills command and reports `TIMEOUT_PROCESS_TREE_KILLED`.
- Output cap kills command and reports `OUTPUT_LIMIT_PROCESS_TREE_KILLED`.
- Invalid `workdir` and invalid env var names are rejected.
- Process-tree cleanup verified with a child process that would create a marker file after parent timeout; marker stayed absent.
