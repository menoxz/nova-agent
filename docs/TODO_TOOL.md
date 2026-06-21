# `todo` persistent task manager

`todo` manages a local structured task list for Nova.

It provides safe task persistence with stable IDs, validated statuses/priorities, filters, summaries, and explicit errors.

## Storage

Default storage path:

```text
<cwd>/.nova/todos.json
```

The store is a JSON file:

```json
{
  "version": 1,
  "createdAt": "2026-06-21T07:13:49.000Z",
  "updatedAt": "2026-06-21T07:13:49.000Z",
  "nextSeq": 3,
  "tasks": []
}
```

Writes are atomic: the tool writes a temp file next to the store and renames it into place.

## Actions

```ts
action:
  | "list"
  | "add"
  | "update"
  | "complete"
  | "remove"
  | "clear"
```

## Task fields

```ts
type TodoTask = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

IDs are stable once created and are not regenerated on update:

```text
todo_<timestamp_base36>_<sequence_base36>
```

## Limits

- max tasks: `500`
- max title length: `240` chars
- max notes length: `2000` chars
- max tags per task: `20`
- max tag length: `40` chars
- max store size: `1 MB`
- list limit default: `100`

Tags are normalized to lowercase and must match:

```text
^[a-z0-9][a-z0-9_.-]*$
```

## Examples

### List tasks

```json
{ "action": "list", "cwd": "repo" }
```

With filters:

```json
{
  "action": "list",
  "cwd": "repo",
  "status": "in_progress",
  "priority": "high",
  "tag": "nova",
  "search": "persistence",
  "includeCompleted": false,
  "limit": 20
}
```

### Add task

```json
{
  "action": "add",
  "cwd": "repo",
  "title": "Implement todo persistence",
  "priority": "high",
  "tags": ["nova", "todo"]
}
```

### Update task

```json
{
  "action": "update",
  "cwd": "repo",
  "id": "todo_mqngac4m_0001",
  "status": "in_progress",
  "notes": "Atomic JSON store"
}
```

### Complete task

```json
{
  "action": "complete",
  "cwd": "repo",
  "id": "todo_mqngac4m_0001"
}
```

### Remove task

```json
{
  "action": "remove",
  "cwd": "repo",
  "id": "todo_mqngac4m_0001"
}
```

### Clear tasks

`clear` is destructive and requires `confirm: true`.

Clear only completed tasks:

```json
{
  "action": "clear",
  "cwd": "repo",
  "status": "completed",
  "confirm": true
}
```

Clear all tasks:

```json
{
  "action": "clear",
  "cwd": "repo",
  "confirm": true
}
```

## Output

Text output includes store path and summary:

```text
## Todo list
Store: C:\repo\.nova\todos.json
Total: 2 | pending: 1 | in_progress: 1 | blocked: 0 | completed: 0 | cancelled: 0

Showing: 2 task(s)

- todo_mqngac4m_0001 [in_progress/high] Implement todo persistence #nova #todo
    notes: Atomic JSON store
```

JSON output is available with:

```json
{ "action": "list", "format": "json" }
```

## Error behavior

Errors are explicit and include allowed statuses/priorities/actions.

Examples:

- missing `confirm=true` on `clear`
- invalid ID format
- invalid status or priority
- title too long
- corrupted JSON store
- store too large
- max task count reached

## Verification performed

Fixture: `tmp/todo-fixture`

Validated:

- `npx tsc --noEmit`
- empty `list`
- `add` with tags/priority and JSON output
- `update` status/notes while keeping stable ID
- `complete`
- `list` filter `includeCompleted=false`
- `list` filter `status=completed`
- `remove`
- `clear` with filter and `confirm=true`
- `clear` without confirm rejected
- title length limit rejected
