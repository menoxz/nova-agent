# CLI Help / Command UX V1

Nova expose une aide intégrée pour utiliser le CLI sans devoir lire le code ni fournir de clé LLM.

## Usage recommandé

Depuis le dépôt, le chemin le plus explicite est :

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts --version
npx tsx src/index.ts --stream "résume le projet"
```

Le binaire local du dépôt peut aussi être testé sans installation globale :

```bash
npm run build
node bin/nova.js --help
node bin/nova.js --version
```

Si le binaire `nova` est installé ou lié localement :

```bash
npm link
nova --help
nova --version
nova version
nova help streaming
nova batch --help
nova tui --help
nova config validate
```

Avec les scripts npm, les arguments CLI doivent être placés après `--` :

```bash
npm run start -- --help
npm run start -- --stream "résume le projet"
```

## Aide globale et par domaine

Ces commandes sont read-only et ne nécessitent pas `LLM_API_KEY` :

```bash
nova --help
nova --version
nova version
nova help
nova help streaming
nova streaming --help
nova config --help
nova batch --help
nova tui --help
nova sessions --help
nova runs --help
nova approvals --help
nova conversations --help
```

## Flags principaux

| Flag | Description |
| --- | --- |
| `--version` / `-v` | Affiche la version du package depuis `package.json` sans LLM/tools. |
| `--profile <id>` | Utilise un profil agent, par exemple `nova.builder`. |
| `--stream` / `--no-stream` | Force le streaming ou le fallback non-streaming. |
| `--stream-mode=compact\|normal\|verbose` | Définit le niveau de détail du rendu live. |
| `--stream-compact` / `--stream-verbose` | Raccourcis pour le mode streaming. |
| `--thinking=hidden\|collapsed\|expanded` | Contrôle l'affichage sûr du thinking/reasoning. |
| `--no-stream-metrics` | Masque timer/tokens/coût estimé. |
| `--no-stream-tools` | Masque les événements tools dans le rendu live. |
| `--event-log` | En batch, active les logs JSONL redacted par item. |
| `--report <path>` | En batch, choisit le chemin du rapport JSON. |
| `--continue-on-error` | En batch, continue après une erreur d'item. |

## TUI Prototype V0

```bash
nova streaming logs
nova tui replay <logId>
nova tui latest --compact
nova tui replay <logId> --verbose
```

`nova tui replay <logId>` et `nova tui latest` relisent les event logs streaming existants et affichent une snapshot terminale sûre : statut, timeline, metrics/tokens, tools, reasoning collapsed, final answer ou erreur. Ces commandes sont read-only et ne nécessitent pas `LLM_API_KEY`.

## Commandes runtime sûres

Les commandes suivantes lisent ou modifient uniquement de la metadata locale ; elles ne déclenchent pas de LLM/tools.

`nova --version`, `nova -v` et `nova version` affichent la version de `package.json` sans lire la configuration LLM, sans nécessiter `LLM_API_KEY` et sans déclencher tools/agent.

`nova batch <file>` est différent : il exécute des prompts et nécessite donc `LLM_API_KEY`. Son aide (`nova batch --help`) reste disponible sans clé.

### Batch

```bash
nova batch prompts.txt
nova batch prompts.json --stream --event-log
nova batch prompts.json --report .nova/batch/report.json --continue-on-error
nova batch prompts.json --dry-run --from task-2 --limit 3
```

### Streaming

```bash
nova streaming logs
nova streaming show <logId>
nova streaming replay <logId>
```

### Config

```bash
nova config show
nova config init [--force]
nova config validate
nova config explain
```

### Sessions / runs / conversations

```bash
nova sessions list
nova sessions current
nova sessions use <sessionId>

nova runs list [sessionId]
nova runs replay <sessionId> <runId>
nova runs report-current
nova runs resume-current [reason]

nova conversations show [sessionId]
nova conversations summary [sessionId]
nova conversations compact [sessionId]
```

### Approvals

```bash
nova approvals list
nova approvals approve <approvalId> [reason]
nova approvals deny <approvalId> [reason]
```

## Erreurs pédagogiques

- Une commande inconnue proche d'un domaine connu suggère l'aide pertinente, par exemple `nova stremaing` → `nova streaming --help`.
- Un argument manquant affiche l'usage attendu et l'aide du domaine.
- Ces chemins d'erreur s'arrêtent avant la création de l'agent et avant la vérification `LLM_API_KEY`.

## Vérification

```bash
npm run check:fast
npm run check
npm run cli:smoke
npm run bin:smoke
npm run eval:release
npm run eval:quality
npm run eval:cli
npm run typecheck
```

`check:fast` est le garde-fou rapide pendant l'itération et avant petits commits. `check` est le garde-fou complet local pour un module terminé : il regroupe typecheck, smokes clés et evals mock release/quality sans nécessiter de vraie clé LLM.
