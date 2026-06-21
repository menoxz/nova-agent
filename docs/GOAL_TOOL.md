# `goal` objective contract manager

`goal` manages one local structured objective contract for Nova.

It stores the current objective, Definition of Done, out-of-scope list, validated status, and a minimal audit history.

## Storage

Default storage path:

```text
<cwd>/.nova/goal.json
```

Writes are atomic:

```text
write temp file → rename to goal.json
```

## Actions

```ts
action:
  | "get"
  | "set"
  | "update"
  | "complete"
  | "clear"
```

## Goal structure

```ts
type GoalContract = {
  id: string;
  objective: string;
  dod: string[];
  outOfScope: string[];
  status: "active" | "blocked" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completionSummary?: string;
}
```

IDs are stable once created:

```text
goal_<timestamp_base36>_<sequence_base36>
```

## Audit history

Each write action appends an event:

```ts
type AuditEvent = {
  at: string;
  action: "set" | "update" | "complete" | "clear";
  goalId?: string;
  status?: "active" | "blocked" | "completed" | "cancelled";
  summary: string;
  changes?: string[];
}
```

History is capped to the last `100` events.

## Limits

- objective max: `2000` chars
- DoD items max: `50`
- out-of-scope items max: `50`
- each DoD / out-of-scope item max: `500` chars
- summary max: `2000` chars
- store max: `1 MB`
- history max: `100` events

## Examples

### Get current goal

```json
{ "action": "get", "cwd": "repo" }
```

### Set goal

```json
{
  "action": "set",
  "cwd": "repo",
  "objective": "Ship goal tool",
  "dod": ["compile", "test", "document"],
  "outOfScope": ["skill tool"]
}
```

If an active/blocked goal already exists, replacing it requires:

```json
{ "action": "set", "confirm": true, "objective": "Replacement goal" }
```

### Update goal

Replace fields:

```json
{
  "action": "update",
  "objective": "Updated objective",
  "dod": ["compile", "test"]
}
```

Append items:

```json
{
  "action": "update",
  "appendDod": ["document"],
  "appendOutOfScope": ["skill tool"],
  "status": "blocked",
  "summary": "Waiting on docs"
}
```

### Complete goal

```json
{
  "action": "complete",
  "summary": "Goal tool implemented, compiled, tested, documented"
}
```

### Clear goal

`clear` is destructive and requires `confirm: true`.

```json
{
  "action": "clear",
  "confirm": true,
  "summary": "Reset goal state"
}
```

## Output

Text output includes current goal and recent history:

```text
## Goal get
Store: C:\repo\.nova\goal.json

### Current goal
ID: goal_mqng..._0001
Status: active
Objective: Ship goal tool

Definition of Done:
- compile
- test

Out of scope:
- skill tool

### History (last 10)
- 2026-06-21T07:20:00.000Z set goal_mqng..._0001 [active]: Goal set
```

JSON output is available:

```json
{ "action": "get", "format": "json" }
```

## Error behavior

Errors are explicit and include allowed statuses/actions.

Examples:

- `set` replacement of active/blocked goal without `confirm=true`
- `clear` without `confirm=true`
- invalid status
- objective too long
- too many DoD/out-of-scope items
- corrupted JSON store
- store too large

## Verification performed

Fixture: `tmp/goal-fixture`

Validated:

- `npx tsc --noEmit`
- empty `get`
- `set` objective + DoD + out-of-scope
- stable goal ID format
- replacement guard requiring `confirm=true`
- `update` append DoD + status + audit summary
- `complete` with completion summary
- `clear` with `confirm=true`
- `clear` without confirm rejected
- objective length limit rejected
- final audit: `npm audit --omit=dev --json` → 0 vulnerabilities
