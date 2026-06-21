# `skill` folder-based local skill registry

`skill` manages reusable Nova skills as complete folders, optimized for auto-suggestion and safe reuse.

The tool is text-only: it stores and returns instructions/resources, but never executes code, scripts, commands, or arbitrary filesystem paths.

## Storage layout

Default root:

```text
<cwd>/.nova/skills/
```

Structure:

```text
.nova/
└── skills/
    ├── _index.json
    ├── LEGACY_MIGRATION.md              # only if migrated from old .nova/skills.json
    └── <skill-slug>/
        ├── SKILL.md                     # main prompt/instructions + frontmatter
        ├── metadata.json                # full validated metadata/version/resources
        ├── CHANGELOG.md                 # generated version log
        ├── references/                  # docs loaded as needed
        ├── templates/                   # text templates/snippets
        ├── models/                      # schemas/model specs
        ├── scripts/                     # stored code examples/helpers; never executed by this tool
        ├── examples/                    # usage examples
        ├── evals/                       # eval prompts/specs
        └── tests/                       # text fixtures/test notes
```

Writes are atomic for JSON/Markdown files:

```text
write temp file → rename target
```

## Nomenclature

Skill slugs are generated from names using kebab-case and deduplicated:

```text
Excel Workbook Reader → excel-workbook-reader
Excel Workbook Reader → excel-workbook-reader-2
```

Recommended naming pattern:

```text
<domain>-<action>-<object>
```

Examples:

```text
excel-read-workbook
pdf-extract-tables
git-safe-inspection
bpmn-srs-cartography
linkedin-profile-optimizer
```

Avoid vague slugs:

```text
helper
utils
document-tool
general-skill
```

## `_index.json`

The index is intentionally lightweight so Nova can list/search skills without loading every full resource.

```ts
type SkillIndex = {
  version: 2;
  createdAt: string;
  updatedAt: string;
  nextSeq: number;
  skills: IndexSkill[];
  audit: AuditEvent[];
}
```

Each indexed skill includes auto-suggestion metadata:

```ts
type IndexSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  aliases: string[];
  domains: string[];
  capabilities: string[];
  positiveTriggers: string[];
  negativeTriggers: string[];
  status: "draft" | "active" | "archived";
  version: number;
  skillDir: string;
  path: string;         // <slug>/SKILL.md
  metadataPath: string; // <slug>/metadata.json
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
```

## `metadata.json`

`metadata.json` mirrors index metadata and adds resources + version history.

```ts
type SkillMetadata = IndexSkill & {
  resources: ResourceFile[];
  versions: SkillVersion[];
}
```

Resource entries:

```ts
type ResourceFile = {
  category: "references" | "templates" | "models" | "scripts" | "examples" | "evals" | "tests";
  path: string;
  size: number;
  hash: string;
  updatedAt: string;
}
```

## Actions

```ts
action:
  | "list"
  | "search"
  | "get"
  | "load"
  | "create"
  | "update"
  | "archive"
  | "remove"
```

## Auto-suggestion fields

For good suggestions, provide these fields on create/update:

```json
{
  "tags": ["excel", "xlsx", "spreadsheet"],
  "aliases": ["xlsx-reader", "spreadsheet-inspector"],
  "domains": ["office", "data"],
  "capabilities": ["read", "inspect", "extract", "validate"],
  "positiveTriggers": [
    "read Excel file",
    "inspect XLSX formulas",
    "extract spreadsheet tables"
  ],
  "negativeTriggers": [
    "create financial model from scratch"
  ]
}
```

Search scoring favors:

1. exact slug/name
2. slug/name contains term
3. aliases
4. tags/domains/capabilities
5. positive triggers + description
6. body content
7. negative trigger penalty

Search output includes score, matched fields and snippet.

## Security model

This tool cannot load arbitrary paths.

Guards:

- `idOrSlug` must be an ID or slug, not a path.
- rejects `/`, `\`, `..`, NUL in `idOrSlug`
- resource paths are relative and validated
- resource paths cannot be absolute, hidden, or traverse upward
- all resource reads/writes are resolved under `.nova/skills/<slug>/<category>/`
- content/resources are text only
- scripts are stored but never executed
- no dynamic imports
- no network access

## Limits

- max skills: `200`
- index max: `2 MB`
- metadata max: `1 MB`
- skill body max: `120000` chars
- resource content max per file: `100000` chars
- resource load budget: `150000` chars
- max resource files per call: `30`
- name max: `100` chars
- description max: `1500` chars
- tags max: `30`
- taxonomy/alias token max: `60` chars
- triggers max: `80` items, each max `240` chars
- audit max: `300` events
- versions max: `100` per skill

## Create example

```json
{
  "action": "create",
  "name": "Excel Workbook Reader",
  "description": "Use when the user asks to inspect Excel or XLSX workbooks, formulas, sheets, ranges, tables, comments, hyperlinks, or workbook metadata.",
  "content": "# Excel Workbook Reader\n\nUse read_excel first. Inspect sheets, ranges, formulas, comments, hyperlinks, and tables. Do not guess workbook contents.",
  "tags": ["excel", "xlsx", "spreadsheet"],
  "aliases": ["xlsx-reader", "spreadsheet-inspector"],
  "domains": ["office", "data"],
  "capabilities": ["read", "inspect", "extract"],
  "positiveTriggers": ["read Excel file", "inspect XLSX formulas"],
  "negativeTriggers": ["create financial model from scratch"],
  "resources": {
    "references": [
      { "path": "formulas.md", "content": "# Formulas\nCheck cached formula results." }
    ],
    "models": [
      { "path": "output-schema.json", "content": "{\"type\":\"object\"}" }
    ],
    "examples": [
      { "path": "basic.md", "content": "Input: inspect workbook.xlsx\nOutput: sheets + formulas" }
    ]
  }
}
```

Creates:

```text
.nova/skills/excel-workbook-reader/
├── SKILL.md
├── metadata.json
├── CHANGELOG.md
├── references/formulas.md
├── models/output-schema.json
├── examples/basic.md
├── templates/
├── scripts/
├── evals/
└── tests/
```

## Update example

```json
{
  "action": "update",
  "idOrSlug": "excel-workbook-reader",
  "capabilities": ["read", "inspect", "validate"],
  "positiveTriggers": ["read Excel file", "validate XLSX formulas"],
  "resources": {
    "tests": [
      { "path": "fixture-note.md", "content": "test fixture placeholder" }
    ]
  },
  "summary": "Add validation trigger and test resource"
}
```

Updates metadata, resource manifest, version history and `CHANGELOG.md`.

## Load resources

```json
{
  "action": "load",
  "idOrSlug": "excel-workbook-reader",
  "includeResources": true,
  "resourceCategory": "references"
}
```

Returns `SKILL.md` plus bounded resource text. It still does not execute anything.

## Archive / remove

Archive hides by default:

```json
{ "action": "archive", "idOrSlug": "excel-workbook-reader" }
```

Access archived:

```json
{ "action": "get", "idOrSlug": "excel-workbook-reader", "includeArchived": true }
```

Remove deletes the whole skill folder and requires confirmation:

```json
{ "action": "remove", "idOrSlug": "excel-workbook-reader", "confirm": true }
```

Audit remains in `_index.json`.

## Legacy migration

If old storage exists:

```text
.nova/skills.json
```

and no new index exists yet, the tool migrates automatically on first access to:

```text
.nova/skills/_index.json
.nova/skills/<slug>/SKILL.md
.nova/skills/<slug>/metadata.json
.nova/skills/<slug>/CHANGELOG.md
```

The legacy file is left untouched. A note is written:

```text
.nova/skills/LEGACY_MIGRATION.md
```

## Verification performed

Validated:

- `npx tsc --noEmit`
- folder lifecycle create/list/search/get/load/update/archive/remove
- creation of required folder tree and files
- resources in references/models/examples/tests
- search score and matched fields for auto-suggestion metadata
- `get` excludes content by default
- `load` includes `SKILL.md` and bounded resources
- archive guard and `includeArchived`
- path traversal guard for `idOrSlug`
- remove confirmation guard
- legacy `.nova/skills.json` migration to folder structure
- cleanup of test fixtures
- final audit: `npm audit --omit=dev --json` → 0 vulnerabilities
