# Batch Mode V1

Batch Mode V1 exécute une liste de prompts en mode non-interactif et produit un rapport JSON structuré.

## Commandes

```bash
nova batch prompts.txt
nova batch prompts.json
nova batch prompts.json --stream
nova batch prompts.json --event-log
nova batch prompts.json --report .nova/batch/report.json
nova batch prompts.json --continue-on-error
nova batch prompts.json --dry-run
nova batch prompts.json --only task-1,task-2
nova batch prompts.json --from task-2 --limit 5
```

Depuis le dépôt sans installer le binaire :

```bash
npx tsx src/index.ts batch prompts.txt
```

Batch exécute réellement des prompts : `LLM_API_KEY` est donc requis, contrairement à `nova batch --help`.

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
- écrit un rapport JSON avec les items sélectionnés marqués `skipped` et `skipReason: "Dry run: item validated but not executed."` ;
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
  "startedAt": "2026-06-21T18:00:00.000Z",
  "finishedAt": "2026-06-21T18:00:03.000Z",
  "durationMs": 3000,
  "options": {
    "streaming": false,
    "eventLog": true,
    "continueOnError": false
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

## Limites V1

- exécution strictement séquentielle ;
- pas de parallélisme ;
- pas de scheduler, daemon, queue ou TUI ;
- pas de retry batch maison : Nova s'appuie sur la robustesse LLM existante.

## Vérification

```bash
npm run batch:smoke
npm run eval:batch
npm run cli:smoke
npm run typecheck
```
