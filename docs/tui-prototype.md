# TUI Premium Command Center

`nova tui` est le **Command Center premium OpenTUI** pour piloter Nova avant publication. Il unifie shell souris/clavier, dashboard, panneaux détaillés, prompt streaming, sessions/runs, configuration, providers/profiles, logs/replay, diagnostics et approvals dans une posture sûre par défaut.

## Commandes

```bash
nova tui                    # ouvre le shell OpenTUI souris/clavier dans un TTY compatible
nova tui dashboard          # snapshot premium non-interactif/scriptable
nova tui status             # alias dashboard
nova tui --no-interactive   # force le snapshot
nova tui --clack            # force le fallback interactif legacy
nova tui --opentui-slice    # ouvre la vertical slice OpenTUI pour validation runtime
nova tui replay <logId>     # replay TUI d'un log streaming existant
nova tui latest             # dernier log streaming
```

Modes de replay conservés :

```bash
nova tui replay <logId> --compact
nova tui replay <logId> --verbose
nova tui latest --mode verbose
```

Pour trouver un `logId` :

```bash
nova streaming logs
```

## Shell premium OpenTUI

Le shell interactif utilise OpenTUI (`@opentui/core`, `@opentui/solid`, `@opentui/keymap`) quand le runtime compatible est disponible. Il fournit une sidebar cliquable, des panneaux scrollables, un input prompt focusable à la souris et une carte clavier stable : `d`, `r`, `s`, `c`, `p`, `a`, `l`, `g`, `v`, `q`. Sous Node sans FFI OpenTUI, `nova tui` retombe sur le fallback Clack; les commandes non-interactives restent inchangées.

Le rendu non-interactif liste les mêmes panneaux que le shell TTY, avec états lisibles `ready`, `warning`, `blocked`, `idle`.

| Panneau | Couverture |
| --- | --- |
| Dashboard | Vue globale config/provider/profile/sessions/approvals/streaming/readiness/safety. |
| Prompt streaming | Prompt agent live avec streaming, sessions activées et event log redacted optionnel. |
| Sessions & runs | Créer une session, sélectionner la session courante, lister sessions/runs locaux, pointer metadata-only. |
| Onboarding/config | Voir l'état config, initialiser `.nova/config.json` avec template sûr, valider sans secrets. |
| Providers/models | Provider doctor, profils provider/model intégrés, présence de clé uniquement `present|missing`. |
| Agent profiles | Profils agent intégrés et métadonnées sanitizées. |
| Logs/replay | Rejouer les logs streaming JSONL redacted via le renderer existant. |
| Diagnostics/readiness | Readiness production/install, blockers, warnings, publish gate. |
| Safety approvals | Lister/decider les approvals locales sans exposer raw tool inputs. |

## Dashboard non-interactif

`nova tui dashboard` affiche un aperçu scriptable :

- config présente/valide ;
- provider/model/protocol et présence de clé sous forme `present|missing` uniquement ;
- profil agent courant ;
- nombre de sessions/runs, session/run courants et dernier statut ;
- approvals pending/total ;
- état streaming/event logs ;
- readiness production/install ;
- panneaux premium et hotkeys ;
- garde-fous : `writeTools=disabled`, `shell=disabled`, `autonomy=disabled`, `liveLLM=disabled`, `secretsDisplayed=false`, `rawNovaDisplayed=false`.

Ce mode permet aux smokes/evals/CI de valider le TUI sans TTY interactif.

## Vertical slice OpenTUI validée

`npm run tui:opentui-smoke` exécute la vertical slice via Bun et `@opentui/solid/preload` :

- rendu OpenTUI avec header, sidebar, scrollbox et input ;
- clic souris sur panneau ;
- hotkey clavier vers le panneau prompt ;
- présence de l'input prompt ;
- invariants `secretsDisplayed=false` et `rawNovaDisplayed=false`.

## Sécurité

- Le TUI ne demande jamais et n'affiche jamais de clé API.
- Les clés restent dans l'environnement (`LLM_API_KEY`) ; si absente, la zone “Prompt streaming” explique le blocage.
- Les appels live provider ne se produisent que quand l'utilisateur lance explicitement un prompt et qu'une clé est déjà présente.
- Les logs streaming restent redacted via `StreamingEventLogStore`.
- Les approvals affichent uniquement de la metadata sûre, pas de raw tool inputs.
- Pas de daemon, scheduler, queue, web dashboard, publish/tag/release/PR.
- Pas d'activation par défaut de write/shell/autonomy.

## Replay conservé

Le renderer de replay continue à afficher :

- statut : `idle`, `running`, `finished`, `error` ;
- modèle, session/run, timestamps ;
- compteur events, tokens, tools ;
- métriques provider/estimées ;
- timeline start/status/tools/metrics/error/finish ;
- tool calls/results avec previews redacted ;
- reasoning collapsed ;
- final answer ou erreur.

## Vérification

```bash
npm run tui:smoke
npm run tui:opentui-smoke
npm run eval:tui
npm run streaming:log-smoke
npm run typecheck
```
