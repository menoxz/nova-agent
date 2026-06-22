# Runbook Nova Agent

## Commandes

```bash
# Lancer en mode interactif
npm run dev

# Lancer avec un prompt unique
npx tsx src/index.ts "Ta question ici"

# Vérifier le typage
npm run typecheck

# Quality Gate V1 — avant commit d'un module terminé
npm run check:fast   # rapide: typecheck + smokes essentiels + eval:slo-smoke, sans LLM_API_KEY
npm run check        # complet local/release-grade: smokes clés + evals mock incluant eval:slo, sans clé LLM réelle

# Provider Profiles / Fallback contrôlé V1
nova providers list
nova providers doctor
npm run providers:smoke
npm run providers:readiness-smoke   # offline readiness only; no live provider call
npm run eval:providers
npm run eval:provider-readiness

# Batch Markdown Report / CI Mode V1
nova batch prompts.json --dry-run --report-md tmp/batch.md --ci  # sans LLM_API_KEY/tools
npm run batch:smoke
npm run eval:batch

# Heartbeat / Autonomous Tasks V1 safe slice
nova heartbeat validate
nova heartbeat tasks
nova heartbeat tick --dry-run   # sans LLM_API_KEY/tools/agent; écrit .nova/heartbeat
nova heartbeat report latest
npm run heartbeat:smoke
npm run eval:heartbeat

# Eval Report / Trend V1 — lecture locale read-only des report.json
nova eval list --json
nova eval report latest
nova eval summary latest --out tmp/eval-summary.md
nova eval compare <previousRunId> <currentRunId> --json
nova eval dashboard latest --previous <previousRunId> --json
npm run eval:report-smoke
npm run eval:slo-smoke
npm run eval:report
npm run eval:slo

# Smoke test Agent Profiles V1
npm run profiles:smoke

# Smoke/eval Memory/Knowledge V1
npm run memory:smoke
npm run eval:memory

# Eval Agent Profiles V1 mock
npm run eval:profiles

# Lancer le serveur MCP stdio read-only
npm run mcp:stdio

# Smoke test MCP local
npm run mcp:smoke

# Lancer le serveur LSP stdio read-only
npm run lsp:stdio

# Smoke test LSP local
npm run lsp:smoke

# Smoke test Policy/Permissions V1
npm run policy:smoke

# Eval LSP mock
npm run eval:lsp

# Eval Policy V1 mock
npm run eval:policy

# MCP Inspector
npx @modelcontextprotocol/inspector npm run mcp:stdio

# Future V1.1 target: replace manual Inspector checks with a documented automated Inspector test command.

# Installer une dépendance
npm install <package>
```

## Quality Gate V1

Utiliser `npm run check:fast` pendant l'itération ou juste avant un petit commit : il regroupe les validations rapides essentielles (`typecheck`, aide/version CLI, heartbeat, rapport eval, `eval:slo-smoke`, binaire local/installé) et ne nécessite pas `LLM_API_KEY`.

Utiliser `npm run check` avant de considérer un module terminé ou prêt pour une gate locale release-grade : il exécute une validation locale proportionnée avec typecheck, smokes clés (`cli`, `config`, `providers`, `streaming:log`, `batch`, `heartbeat`, `eval:report-smoke`, `eval:slo-smoke`, `tui`, `bin`) et evals mock `release`/`quality`/`providers`/`heartbeat`/`report`/`slo`. Cette commande ne publie rien, ne pousse rien, ne tague rien, n'ajoute pas de CI distante et ne dépend pas d'une vraie clé LLM.

Utiliser `npm run eval:slo-smoke` pour vérifier rapidement la CLI dashboard/SLO sur fixtures temporaires sanitizées. Utiliser `npm run eval:slo` quand la gate doit exécuter la suite SLO mock complète et écrire un rapport eval local. Si `check:fast` échoue, corriger avant de lancer `check`. Si `check`, `eval:slo-smoke` ou `eval:slo` échoue après un changement local, traiter l'échec comme une régression jusqu'à preuve du contraire.

Provider live smoke readiness reste offline/mock-only en V1 : suivre `docs/provider-live-smoke-readiness.md` (inclus dans le package npm), exécuter `npm run providers:readiness-smoke` et `npm run eval:provider-readiness`, et ne lancer aucun appel provider/LLM réel sans autorisation future explicite.

## Release Candidate Dry-Run V1

Pour une vérification release-candidate sans effet de publication, suivre `docs/release-candidate-dry-run-checklist.md` (inclus dans le package npm). Le périmètre interdit `npm publish`, tag, push, PR, appels provider/LLM live, daemon/autonomie, et lecture de secrets/prompts ou artefacts bruts `.nova`.

La commande packaging pure read-only est :

```bash
npm pack --dry-run --ignore-scripts
```

Ne pas remplacer cette commande par `npm pack` normal : le lifecycle `prepack` lance `npm run build`, donc écrit `dist/` avant de créer un tarball. Les simulations d'installation (`npm link`, installation tarball en dossier temporaire) mutent l'état npm global ou des dossiers externes et exigent une autorisation explicite avec nettoyage documenté.

## Batch reports et CI mode

Pour valider un fichier batch sans appeler le LLM :

```bash
nova batch prompts.json --dry-run --report tmp/batch.json --report-md tmp/batch.md --ci
```

Le dry-run n'exige pas `LLM_API_KEY`, ne crée pas d'agent et n'exécute aucun tool. `--report-md` produit un rapport Markdown lisible en plus du JSON. `--ci` imprime des lignes stables `BATCH_SUMMARY`, `BATCH_REPORT_JSON`, `BATCH_REPORT_MD` et `BATCH_ITEM`, et garde un exit code strict : `0` uniquement si le batch est `completed`.

## Heartbeat V1

Heartbeat est une tranche sûre pour futures tâches autonomes. V1 est désactivé par défaut, ne démarre jamais automatiquement et ne fournit que des commandes explicites :

```bash
nova heartbeat --help
nova heartbeat validate
nova heartbeat status
nova heartbeat tasks
nova heartbeat tick --dry-run
nova heartbeat report latest
```

`tick --dry-run` ne lit pas `.env`, ne requiert pas `LLM_API_KEY`, n'instancie pas `NovaAgent`, n'exécute aucun tool et écrit uniquement `.nova/heartbeat/state.json`, `.nova/heartbeat/ticks/*.json`, `.nova/heartbeat/ticks/*.md` et un lock temporaire anti-overlap. Les tâches `shell`, `write`, `git`, `network`, `memory-write`, `auto-resume` sont bloquées.

## Eval Report / Trend V1

Pour inspecter les runs eval locaux sans appeler de provider ni relire les traces brutes :

```bash
nova eval list [--limit N] [--json]
nova eval report latest|<evalRunId> [--json]
nova eval summary latest|<evalRunId> [--markdown]
nova eval summary <evalRunId> --out tmp/eval-summary.md
nova eval compare <previousRunId> <currentRunId> [--json|--markdown]
nova eval dashboard latest|<evalRunId> [--json] [--previous <previousRunId>]
nova eval slo latest|<evalRunId> [--json] [--previous <previousRunId>]
```

Ces commandes s'arrêtent avant dotenv, `NovaAgent`, setup tools et la vérification `LLM_API_KEY`. Elles lisent seulement `.nova/evals/*/report.json`, rejettent les ids avec traversal/séparateurs, n'exposent pas `finalAnswer` ni `checks.actual`, et ne modifient jamais les rapports existants sous `.nova/evals`.

`compare` est prévu pour automation locale stable : pass rate delta, deltas passed/failed/errors/total, gates previous/current, scénarios échoués avant/après, nouveaux échecs et scénarios récupérés.

`dashboard` (alias `slo`) produit un objet JSON stable `schemaVersion: 1` ou une sortie humaine avec pass rate, erreurs, gates, budgets tool-call configurés, readiness et régression optionnelle via `--previous`. Interpréter les résultats uniquement via les sorties sanitizées du CLI (`nova eval report`, `nova eval summary`, `nova eval compare`, `nova eval dashboard`/`slo`) ou les synthèses/rapports redacted générés par les scripts, pas en ouvrant manuellement les corps bruts `.nova/evals`.

Interprétation SLO : un échec de gate signifie que le pass rate, les erreurs ou les budgets configurés ne respectent pas la barre locale; `readiness` liste les bloqueurs à lever avant de considérer la validation prête; une `regression` avec `--previous` indique une baisse de pass rate, une hausse d'erreurs ou des scénarios précédemment verts devenus rouges. Les rapports consultables doivent rester des synthèses/redactions; ne pas inspecter `.env`, secrets, prompts, raw `.nova/traces`, raw `.nova/evals`, raw `.nova/reports`, `finalAnswer`/`checks.actual` ni lancer provider live/tools/daemon/autonomie.

Validation dédiée : `npm run eval:report-smoke`, `npm run eval:slo-smoke`, `npm run eval:report` puis `npm run eval:slo`.

## Configuration (.env)

```env
LLM_PROVIDER=openmodel       # openmodel | openai | anthropic | openrouter
LLM_BASE_URL=https://api.openmodel.ai/v1
LLM_API_KEY=ta-clé-api
LLM_MODEL=deepseek-v4-flash
NOVA_PROFILE=nova.general      # optional: nova.security, nova.builder, nova.qa, etc.
NOVA_PROVIDER_PROFILE=openmodel-deepseek-v4-flash
# NOVA_PROVIDER_FALLBACK=openrouter-deepseek-v4-flash,openai-gpt-4o-mini  # opt-in only, never silent
```

## Changer de Provider

### Pour utiliser OpenAI
```env
NOVA_PROVIDER_PROFILE=openai-gpt-4o-mini
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=gpt-4o
```

### Pour utiliser OpenRouter
```env
NOVA_PROVIDER_PROFILE=openrouter-deepseek-v4-flash
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=openmodel/deepseek-v4-flash
```

### Pour utiliser DeepSeek direct
```env
NOVA_PROVIDER_PROFILE=deepseek-chat
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=deepseek-chat
```

## Memory/Knowledge V1

The implementation is under `src/memory/` and the design/acceptance docs are under `docs/memory/` in the source repository only; those memory design docs are not shipped in the slim npm package:

- `README.md`: goals, types, scopes, built-in collections, acceptance summary.
- `ARCHITECTURE.md`: components, data flow, integration with profiles/agent/subagents/policy/eval/MCP/LSP.
- `PERSISTENCE.md`: `.nova/memory` layout, schemas, hashes, migrations, atomic writes, index rebuild, import/export.
- `SECURITY.md`: no secrets/raw artifacts, prompt injection/poisoning defenses, safe audit/import/export.
- `RETRIEVAL.md`: when to retrieve, ranking, token budgets, stale handling, profile scope, policy gates, untrusted wrapper.
- `LIFECYCLE.md`: write pipeline, retention, TTL, confidence decay, consolidation, archive/delete.
- `EVAL.md`: smoke/eval acceptance criteria.
- `BACKLOG_V1_1.md`: post-V1 enhancements.

Do not manually place secrets, raw `.nova/traces`, raw `.nova/evals`, raw `.nova/reports`, `.env`, or private-key material under `.nova/memory`.

## Ajouter un Outil

1. Créer `src/tools/builtin/ma_fonction.ts`:
```typescript
import { z } from 'zod';
import type { NovaTool } from '../../types.js';

export const myTool: NovaTool = {
  name: 'my_tool',
  description: 'Description claire pour le LLM.',
  inputSchema: z.object({
    param1: z.string().describe('Description du paramètre'),
  }),
  execute: async ({ param1 }) => {
    // Logique ici
    return 'Résultat';
  },
};
```

2. Enregistrer dans `src/index.ts`:
```typescript
import { myTool } from './tools/builtin/my_tool.js';
// ...dans setupTools():
registry.register(myTool);
```

## Liste Complète des Outils (v10)

| Outil | Description | Nouveautés Itération 3 | Dangereux |
|-------|-------------|----------------------|-----------|
| `read_file` | Lit fichier texte/binaire. Modes: full, head, tail, hex | 🔥 Détection binaire, head/tail/hex, type fichier, hash | ❌ |
| `write_file` | Écrit ou append. Dry-run, diff, atomic, backup | 🔥 Dry-run diff, atomic write, backup .bak | ✅ (écrase) |
| `bash` | Exécute commande shell. Env vars, stdin | 🔥 Env vars, stdin pipe, meilleur handling signaux | ✅ (modifie système) |
| `glob` | Cherche fichiers par pattern (\*, \*\*, ?) | 🔥 Exclude patterns, depth limit | ❌ |
| `grep` | Cherche texte par regex dans fichiers | 🔥 Binary skip, context lines, count, inverse match | ❌ |
| `list_directory` | Liste dossier (type/size/date). Récursif, summary | 🔥 Mode récursif arborescence, summary, total size | ❌ |
| `get_file_info` | Metadata fichier/dossier. Hash, MIME, multi | 🔥 SHA256 hash, MIME type, multi-path support | ❌ |

### Nouveaux paramètres par outil

**read_file**: `mode: "full"|"head"|"tail"|"hex"`, `lines: number`, `offset`, `limit`
**write_file**: `mode: "write"|"append"`, `backup`, `dryRun`, `atomic`
**bash**: `command`, `timeout`, `workdir`, `description`, `stdin`, `env: Record<string,string>`
**glob**: `pattern`, `root`, `maxResults`, `exclude: string[]`, `depth`
**grep**: `pattern`, `root`, `include`, `ignoreCase`, `maxResults`, `beforeContext`, `afterContext`, `invertMatch`, `count`
**list_directory**: `path`, `showHidden`, `sortBy`, `recursive`, `depth`, `summary`
**get_file_info**: `path`, `hash: boolean` (multi-chemins via virgule: "a.ts, b.ts")

## Débogage

### Problème: "route not found"
→ Vérifier que `LLM_BASE_URL` est correct et que le provider correspond au format d'API (Anthropic vs OpenAI).

### Problème: L'agent ne répond pas
→ Vérifier la connexion API: `curl.exe -X POST "$LLM_BASE_URL/messages" ...`
→ Vérifier la clé API dans `.env`
→ Vérifier les logs d'erreur dans la console

### Problème: Les outils ne sont pas appelés
→ Vérifier que le LLM supporte le tool calling (deepseek-v4-flash ✅)
→ Vérifier que le system prompt contient bien la description des outils
→ Vérifier que `maxSteps` n'est pas trop bas

### Problème: TypeError à l'import
→ Vérifier que les fichiers utilisent l'extension `.js` dans les imports (ESM)
→ Vérifier que `tsconfig.json` a `"module": "ESNext"`

## Structure pour un Nouvel Outil

```typescript
// Modèle à copier-coller
import { z } from 'zod';
import type { NovaTool } from '../../types.js';

export const monOutil: NovaTool = {
  name: 'mon_outil',
  description: 'Ce que fait cet outil.',
  inputSchema: z.object({
    // Paramètres avec descriptions pour le LLM
    chemin: z.string().describe('Chemin vers quelque chose'),
    option: z.boolean().optional().describe('Option activable'),
  }),
  execute: async ({ chemin, option }) => {
    try {
      // Implémentation
      return `Succès: ${chemin}`;
    } catch (err) {
      return `Erreur: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```
