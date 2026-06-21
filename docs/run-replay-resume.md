# Run Replay / Resume V1

Run Replay / Resume V1 rend les sessions, runs et approvals actionnables après un blocage, une approval ou un échec, sans transformer la CLI runtime en exécuteur risqué.

## Objectifs

- Relire un run sous forme de timeline/report metadata-only.
- Reprendre un run via un run enfant planifié.
- Conserver les approvals comme contexte décisionnel, pas comme autorisation d'auto-exécution.
- Exposer une CLI minimale sûre pour l'opérateur local.

## Commandes CLI

```bash
nova runs replay <sessionId> <runId>
nova runs report <sessionId> <runId>
nova runs resume <sessionId> <runId> [reason]
```

Ces commandes n'appellent ni LLM ni outil agent. Elles lisent/écrivent uniquement les métadonnées locales `.nova/sessions`.

## Replay metadata-only

`runs replay` retourne :

- statut, objectif et preview d'entrée bornée ;
- plan et statuts des étapes ;
- budgets limites/usage ;
- approvals et décisions ;
- événements horodatés ;
- liens d'observabilité metadata-only ;
- rapport final si présent ;
- relations parent/enfant éventuelles ;
- bloc `safety` confirmant `metadataOnly`, `llmInvoked: false`, `toolsInvoked: false`.

Le replay ne contient pas de prompt complet, input tool brut, secret, trace brute ou rapport `.nova` brut.

## Resume contrôlé

`runs resume` crée un run enfant :

- `status: planned` ;
- `relationships.parentRunId` et `relationships.resumedFromRunId` pointent vers le run source ;
- le run source reçoit `relationships.childRunIds[]` ;
- la session pointe `activeRunId` vers le run enfant ;
- les approvals source sont résumées par ids/statuts/capabilities/actions ;
- les approvals ne sont pas copiées comme actions exécutables.

Le run enfant contient `resume.safety.autoExecuteApprovedActions: false`. Même si une approval source est `approved`, l'action risquée doit être re-planifiée et repasser par la policy au moment réel d'exécution.

## Statuts reprenables V1

Un run peut être repris s'il est :

- `planned`
- `waiting_approval`
- `failed`
- `cancelled`

Les runs `running` ou `succeeded` ne sont pas repris en V1 pour éviter les duplications ambiguës.

## Garanties de sécurité V1

- Pas de ré-exécution automatique d'outil risqué.
- Pas d'appel LLM pendant replay/resume CLI.
- Pas de stockage de prompts complets ni inputs tools bruts.
- Pas de backend externe.
- Pas de lecture de raw traces/evals ou secrets.

## Validation

```bash
npm run replay:smoke
npm run eval:run-replay
```
