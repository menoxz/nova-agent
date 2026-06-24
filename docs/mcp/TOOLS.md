# MCP Tool Catalog

All registered tools use the `nova_*` namespace.

## Enabled by default

- `nova_tool_catalog` — list MCP tools and safety posture.
- `nova_mcp_capabilities` — list read-only capabilities, limits, resources, prompts, and disabled mutating tool families.
- `nova_read_file` — read approved UTF-8 text files with caps/redaction.
- `nova_list_directory` — list approved directories while skipping denied children.
- `nova_search_files` — glob-like file search under approved roots.
- `nova_search_text` — literal search across approved text files by default; guarded regex search requires `regex: true`.
- `nova_git_status` — bounded read-only `git status`.
- `nova_git_diff` — bounded read-only `git diff`.
- `nova_git_log` — bounded read-only `git log`.
- `nova_doc_read` — safe document reading for approved `.pdf`, `.docx`, `.xlsx`, `.md`, `.txt` files.
- `nova_web_search` — bounded DuckDuckGo-backed search reusing the existing Nova web search implementation.
- `nova_eval_list_scenarios` — list eval scenario metadata and suites; no raw reports.
- `nova_eval_schema_info` — schema/policy summary for eval/trace artifacts.
- `nova_trace_summarize` — sanitized aggregate trace summary only; no raw trace events.

## Absent/disabled by default

- `nova_bash`
- `nova_write_file`

State tools (`nova_todo_*`, `nova_goal_*`, `nova_skill_*`) are not registered in V1.

## V1.1 metadata

`nova_mcp_capabilities` and `nova://tools/schemas` expose curated tool metadata and input summaries only. They do not expose allowed-root path lists, raw `.nova` artifacts, or hidden write/shell tools.
