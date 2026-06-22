# Batch Mode V1.2

Batch Mode V1.2 exécute une liste de prompts en mode non-interactif, produit un rapport JSON structuré, peut générer un rapport Markdown lisible et expose un mode CI stable pour l'automation.

## Commandes

```bash
nova batch prompts.txt
nova batch prompts.json
nova batch prompts.json --stream
nova batch prompts.json --event-log
nova batch prompts.json --report .nova/batch/report.json
nova batch prompts.json --report-md .nova/batch/report.md
nova batch prompts.json --ci
nova batch prompts.json --continue-on-error
nova batch prompts.json --dry-run
nova batch prompts.json --dry-run --report-md tmp/report.md --ci
nova batch prompts.json --only task-1,task-2
nova batch prompts.json --from task-2 --limit 5
```

Depuis le dépôt sans installer le binaire :

```bash
npx tsx src/index.ts batch prompts.txt
```

Batch exécute réellement des prompts : `LLM_API_KEY` est donc requis, contrairement à `nova batch --help` et aux chemins `--dry-run`.

## Formats d'entrée

### `.txt`

Un prompt par ligne :

```txt
# commentaires ignorés
Résume docs/README.md
// commentaire ignoré
Liste les risques du projet
```

- lignes vides ignorées ;
- lignes commençant par `#` ou `//` ignorées ;
- l'id d'item est dérivé de la ligne source, par exemple `line-2`.

### `.json`

Tableau d'objets `{ id, prompt }` :

```json
[
  { "id": "task-1", "prompt": "Résume docs/README.md" },
  { "id": "task-2", "prompt": "Liste les risques du projet" }
]
```

Validation V1 :

- `id` non vide, unique, 1 à 80 caractères ;
- caractères sûrs pour `id` : lettres, chiffres, `.`, `_`, `-` ;
- `prompt` non vide ;
- extension supportée : `.txt` ou `.json`.

## Options

| Option | Effet |
| --- | --- |
| `--stream` | Affiche le rendu streaming pour chaque item. |
| `--event-log` | Active les logs JSONL redacted par item sous `.nova/streaming/events`. |
| `--report <path>` | Écrit le rapport JSON à un chemin choisi. Par défaut : `.nova/batch/<batchId>.json`. |
| `--report-md <path>` | Écrit un rapport Markdown lisible avec résumé global, tableau items, erreurs/détails et références `run`/`eventLog` quand disponibles. |
| `--ci` | Affiche des lignes console stables `BATCH_*` adaptées automation; exit code non-zéro si le batch n'est pas `completed`. |
| `--continue-on-error` | Continue après une erreur d'item. Par défaut, Nova s'arrête et marque le reste `skipped`. |
| `--dry-run` | Valide le fichier, applique les filtres, affiche les items et écrit un rapport sans LLM/tools ni `LLM_API_KEY`. |
| `--limit N` | Sélectionne au plus `N` items à exécuter/valider. |
| `--only id1,id2` | Sélectionne uniquement les ids listés. |
| `--from id` | Reprend la sélection à partir de l'id donné. |

`--event-log` force le chemin d'exécution streaming en interne pour capturer les événements, même si `--stream` n'est pas demandé. Sans `--stream`, les événements sont persistés mais pas affichés live.

## Dry-run et filtres

`--dry-run` est le chemin recommandé avant une exécution longue :

```bash
nova batch prompts.json --dry-run --from task-2 --limit 3
```

Le dry-run :

- parse et valide le fichier ;
- vérifie que `--only` / `--from` référencent des ids existants ;
- affiche les items sélectionnés ;
- écrit un rapport JSON, et un rapport Markdown si `--report-md` est fourni, avec les items sélectionnés marqués `skipped` et `skipReason: "Dry run: item validated but not executed."` ;
- ne vérifie pas `LLM_API_KEY` et ne crée pas d'agent/tools.

Les filtres sont appliqués dans cet ordre :

1. `--from id` ignore les items avant `id` ;
2. `--only id1,id2` conserve seulement ces ids ;
3. `--limit N` borne le nombre d'items sélectionnés.

## Rapport JSON

Exemple de structure :

```json
{
  "schemaVersion": 1,
  "batchId": "batch_lx1234_abcd1234",
  "status": "completed",
  "inputFile": "C:/project/prompts.json",
  "reportPath": "C:/project/.nova/batch/batch_lx1234_abcd1234.json",
  "reportMarkdownPath": "C:/project/.nova/batch/batch_lx1234_abcd1234.md",
  "startedAt": "2026-06-21T18:00:00.000Z",
  "finishedAt": "2026-06-21T18:00:03.000Z",
  "durationMs": 3000,
  "options": {
    "streaming": false,
    "eventLog": true,
    "reportMarkdown": true,
    "ci": false,
    "continueOnError": false,
    "dryRun": false
  },
  "counts": {
    "total": 2,
    "success": 2,
    "error": 0,
    "skipped": 0
  },
  "items": [
    {
      "id": "task-1",
      "status": "success",
      "durationMs": 1234,
      "promptPreview": "Résume docs/README.md",
      "answerPreview": "...",
      "metrics": {},
      "run": { "sessionId": "...", "runId": "..." },
      "eventLog": { "logId": "...", "path": "..." }
    },
    {
      "id": "task-2",
      "status": "skipped",
      "skipReason": "Skipped by --limit 1.",
      "promptPreview": "..."
    }
  ]
}
```

Les previews sont bornées et redacted. Les prompts complets ne sont pas recopiés dans le rapport.

## Rapport Markdown

`--report-md <path>` écrit un fichier Markdown humainement lisible en plus du JSON :

```bash
nova batch prompts.json --report .nova/batch/report.json --report-md .nova/batch/report.md
```

Contenu V1.2 :

- résumé global : status, input file, chemins de rapports, timestamps, durée, compteurs, options ;
- tableau items : `id`, `status`, durée, tokens, coût, références `run` et `eventLog` ;
- section détails par item : erreur ou `skipReason`, prompt preview et answer preview quand disponible.

Le rapport Markdown est aussi disponible en dry-run sans clé LLM :

```bash
nova batch prompts.json --dry-run --report-md tmp/batch.md
```

## Mode CI

`--ci` remplace la sortie humaine colorée par des lignes stables, faciles à parser :

```bash
nova batch prompts.json --ci --report-md .nova/batch/report.md
```

Exemple de sortie :

```text
BATCH_ITEM_START index=1 total=2 id=task-1
BATCH_ITEM_RESULT index=1 total=2 id=task-1 status=success durationMs=1234
BATCH_SUMMARY status=completed total=2 success=2 error=0 skipped=0 durationMs=3000
BATCH_REPORT_JSON path=C:/project/.nova/batch/batch_lx1234_abcd1234.json
BATCH_REPORT_MD path=C:/project/.nova/batch/report.md
BATCH_ITEM id=task-1 status=success durationMs=1234
```

Exit codes :

- `0` si le rapport final est `completed` ;
- `1` si parsing/options/LLM échoue ou si le rapport final est `failed` ou `partial`.

`--ci` fonctionne aussi avec `--dry-run` sans `LLM_API_KEY` ni tools/agent :

```bash
nova batch prompts.json --dry-run --ci --report-md tmp/batch.md
```

## Limites V1

- exécution strictement séquentielle ;
- pas de parallélisme ;
- pas de scheduler, daemon, queue ou TUI ;
- pas de retry batch maison : Nova s'appuie sur la robustesse LLM existante.

## Vérification

```bash
npm run batch:smoke
npm run eval:batch
npm run check:fast
npm run cli:smoke
npm run typecheck
```
