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
nova providers doctor
nova production readiness
nova config validate
nova heartbeat --help
nova heartbeat tick --dry-run
nova eval list
nova eval report latest
nova eval compare <previousRunId> <currentRunId>
nova eval dashboard latest --previous <previousRunId> --json
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
nova providers --help
nova sessions --help
nova runs --help
nova approvals --help
nova conversations --help
nova heartbeat --help
nova eval --help
nova production --help
```

## Flags principaux

| Flag | Description |
| --- | --- |
| `--version` / `-v` | Affiche la version du package depuis `package.json` sans LLM/tools. |
| `--profile <id>` | Utilise un profil agent, par exemple `nova.builder`. |
| `--provider-profile <id>` | Utilise un profil provider/model intégré. |
| `--provider-fallback <ids>` | Déclare des profils fallback opt-in, séparés par virgule; jamais silencieux. |
| `--stream` / `--no-stream` | Force le streaming ou le fallback non-streaming. |
| `--stream-mode=compact\|normal\|verbose` | Définit le niveau de détail du rendu live. |
| `--stream-compact` / `--stream-verbose` | Raccourcis pour le mode streaming. |
| `--thinking=hidden\|collapsed\|expanded` | Contrôle l'affichage sûr du thinking/reasoning. |
| `--no-stream-metrics` | Masque timer/tokens/coût estimé. |
| `--no-stream-tools` | Masque les événements tools dans le rendu live. |
| `--event-log` | En batch, active les logs JSONL redacted par item. |
| `--report <path>` | En batch, choisit le chemin du rapport JSON. |
| `--report-md <path>` | En batch, écrit un rapport Markdown lisible. |
| `--ci` | En batch, active une sortie stable `BATCH_*` pour automation et des exit codes stricts. |
| `--continue-on-error` | En batch, continue après une erreur d'item. |

## TUI Premium Command Center

```bash
nova tui
nova tui dashboard
nova tui --clack
nova tui --opentui-slice
nova streaming logs
nova tui replay <logId>
nova tui latest --compact
nova tui replay <logId> --verbose
```

`nova tui` ouvre un Command Center premium OpenTUI dans un TTY compatible : shell souris/clavier, sidebar cliquable, scrollbox, input prompt focusable, dashboard, prompt agent avec streaming live, sessions/runs, configuration sûre, providers/profiles, logs/replay, diagnostics/readiness et safety approvals. `nova tui dashboard` fournit le même aperçu en mode non-interactif/scriptable avec panneaux, hotkeys et états lisibles. `--clack` force le fallback legacy et `--opentui-slice` ouvre la vertical slice de validation runtime.

`nova tui replay <logId>` et `nova tui latest` restent compatibles : ils relisent les event logs streaming existants et affichent une snapshot terminale sûre : statut, timeline, metrics/tokens, tools, reasoning collapsed, final answer ou erreur.

Sécurité : le TUI ne demande ni n'affiche jamais de clé API, raw `.nova` ou raw tool inputs. Les prompts live nécessitent `LLM_API_KEY` déjà présent dans l'environnement. Les write/shell/autonomy restent désactivés par défaut.

## Commandes runtime sûres

Les commandes suivantes lisent ou modifient uniquement de la metadata locale ; elles ne déclenchent pas de LLM/tools.

`nova --version`, `nova -v` et `nova version` affichent la version de `package.json` sans lire la configuration LLM, sans nécessiter `LLM_API_KEY` et sans déclencher tools/agent.

`nova providers list`, `nova providers show <id>` et `nova providers doctor` sont read-only : ils listent le Provider Directory metadata-only et les Provider Profiles exécutables, diagnostiquent la configuration provider sans appel LLM, sans tools et sans afficher la valeur de `LLM_API_KEY`. Une entrée planned/gateway/custom du Directory n'est pas prétendue exécutable.

`nova batch <file>` est différent : il exécute des prompts et nécessite donc `LLM_API_KEY`. Son aide (`nova batch --help`) et `nova batch <file> --dry-run` restent disponibles sans clé, y compris avec `--report-md` et `--ci`.

`nova heartbeat validate/status/tasks/tick --dry-run/report latest` est planning-only : aucun `LLM_API_KEY`, aucun agent/tool, aucun daemon et aucun démarrage automatique.

`nova eval list/report/summary/compare/dashboard/slo` relit uniquement les rapports structurés `.nova/evals/*/report.json`. Ces commandes ne lisent pas `.env`, `report.md`, raw `.nova/traces`, prompts bruts ou secrets; elles n'instancient pas `NovaAgent`, ne configurent aucun tool et ne nécessitent pas `LLM_API_KEY`.

`nova production readiness` et `nova production doctor` produisent un diagnostic offline/static d'installation et de production : version `0.1.0`, bins `nova`/`nova-mcp`, `main`, docs packagées, scripts `check`/`release:readiness`, couverture security matrix, surface package slim et priorisation des bloqueurs actifs. Ils ne lisent pas `.env`, secrets ou raw `.nova`, n'appellent aucun provider, n'exécutent aucun tool, ne publient rien et ne démarrent aucun daemon.

### Batch

```bash
nova batch prompts.txt
nova batch prompts.json --stream --event-log
nova batch prompts.json --report .nova/batch/report.json --continue-on-error
nova batch prompts.json --dry-run --from task-2 --limit 3
nova batch prompts.json --report-md .nova/batch/report.md
nova batch prompts.json --dry-run --ci --report-md tmp/batch.md
```

`--report-md` ajoute un rapport Markdown avec résumé, tableau items, erreurs/détails et références `run`/`eventLog` quand disponibles. `--ci` imprime des lignes `BATCH_*` stables et retourne `1` si le batch n'est pas `completed`.

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

### Heartbeat

```bash
nova heartbeat validate
nova heartbeat status
nova heartbeat tasks
nova heartbeat tick --dry-run
nova heartbeat report latest
```

Heartbeat V1 est désactivé par défaut et écrit uniquement des rapports metadata-only/redacted sous `.nova/heartbeat`.

### Eval reports

```bash
nova eval list [--limit N] [--json]
nova eval report latest|<evalRunId> [--json]
nova eval summary latest|<evalRunId> [--markdown]
nova eval summary <evalRunId> --out tmp/eval-summary.md
nova eval compare <previousRunId> <currentRunId> [--json|--markdown]
nova eval dashboard latest|<evalRunId> [--json] [--previous <previousRunId>]
nova eval slo latest|<evalRunId> [--json] [--previous <previousRunId>]
```

La sortie par défaut évite les champs bruts sensibles (`finalAnswer`, `checks.actual`) et résume uniquement metadata, pass rate, compteurs, gates et scénarios échoués avec erreurs tronquées/redacted. `compare` affiche les deltas pass rate/passed/failed/errors/total, les gates, les échecs avant/après, les nouveaux échecs et les scénarios récupérés. `summary --out` écrit un Markdown hors de `.nova/evals` pour ne pas modifier les rapports existants.

`dashboard`/`slo` ajoute un état readiness, les gates, les budgets tool-call configurés et la régression optionnelle via `--previous`, sans dashboard web ni lecture de traces/prompts/secrets/corps eval bruts.

### Providers

```bash
nova providers list
nova providers show openmodel-deepseek-v4-flash
nova providers doctor
nova --provider-profile openmodel-deepseek-v4-flash providers doctor
```

### Production readiness

```bash
nova production readiness
nova production doctor
npm run production:smoke
npm run eval:production
```

Le champ `readiness.ready` indique si aucun bloqueur actif d'installation n'est détecté. Les gates volontairement bloqués (`npm publish`, tag/release/PR, live provider, daemon/autonomie) restent listés dans `explicitOutOfScope` et ne rendent pas le diagnostic installable négatif.

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
npm run heartbeat:smoke
npm run eval:report-smoke
npm run eval:slo-smoke
npm run eval:heartbeat
npm run eval:release
npm run eval:quality
npm run production:smoke
npm run eval:production
npm run eval:cli
npm run eval:report
npm run eval:slo
npm run typecheck
```

`check:fast` est le garde-fou rapide pendant l'itération et avant petits commits : il inclut `eval:slo-smoke` sans nécessiter de vraie clé LLM. `check` est le garde-fou complet local pour un module terminé : il regroupe typecheck, smokes clés et evals mock release/quality/providers/heartbeat/report/slo sans clé LLM réelle.
