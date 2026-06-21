# Session + Run Manager V1 — plan définitif

Nova dispose maintenant de contexte, mémoire, ReAct, outils, MCP, LSP, evals, traces, agents et sous-agents. La brique manquante est la gestion explicite des **sessions** et des **runs** : elle donne une unité de pilotage, de reprise, de budget, d'approbation et d'observabilité.

## Définitions

| Concept | Durée | Rôle | Exemple |
|---|---|---|---|
| Conversation | courte, en RAM V1 | Historique messages user/assistant/tool utilisé par la boucle ReAct. | Les messages de `ConversationMemory`. |
| Session | moyenne/longue | Espace de travail logique autour d'un objectif utilisateur ou projet. Contient plusieurs runs. | “Implémenter Nova Context Builder”. |
| Run | ponctuel | Une exécution traçable d'une demande dans une session. | “Ajoute le smoke test et lance typecheck”. |
| Trace | ponctuel | Journal technique d'un run ReAct/tools/LLM. | `.nova/traces/*.json`. |
| Eval | ponctuel/batch | Vérification déterministe ou live d'un comportement attendu. | `eval:context`. |

Une session peut contenir plusieurs runs. Un run peut produire une trace, des propositions mémoire, des rapports subagents, des approvals et des métriques token/coût.

## Objectifs V1

- Créer et persister localement sessions/runs sous `.nova/sessions`.
- Lier run ↔ session ↔ trace/context/memory/profile/subagents via métadonnées, sans stocker de contenus sensibles bruts.
- Fournir un planner minimal déterministe pour initier un plan de run.
- Suivre budgets : tool calls, durée, tokens, coût estimé.
- Suivre approvals : demandes, décisions, raisons, statut.
- Produire un rapport final compact.
- Rester progressif : pas de refonte destructive de `NovaAgent.run()` en V1 initiale.

## Lifecycle

### Session

```txt
active → idle → closed → archived
```

- `active` : reçoit des runs.
- `idle` : aucun run actif.
- `closed` : fin fonctionnelle, lecture/replay possible.
- `archived` : conservation historique.

### Run

```txt
planned → running → waiting_approval → running → succeeded|failed|cancelled
```

- `planned` : run créé avec plan minimal.
- `running` : exécution en cours.
- `waiting_approval` : action risquée/coût dépassé en attente.
- `succeeded` : objectif atteint.
- `failed` : erreur ou vérification échouée.
- `cancelled` : arrêt demandé.

## Architecture cible

```txt
src/session/
  types.ts          # types Session, Run, budget, approvals, events
  paths.ts          # chemins sûrs sous .nova/sessions
  store.ts          # persistance JSON locale + index
  planner.ts        # planner minimal déterministe
  budget.ts         # agrégation et dépassement budgets
  report.ts         # résumé final metadata-only
  manager.ts        # API principale create/start/update/finish
  smoke.ts          # smoke test local
  index.ts
```

## Persistence locale

```txt
.nova/sessions/
  _index.json
  sessions/<sessionId>.json
  runs/<sessionId>/<runId>.json
```

Les fichiers ne contiennent pas de prompts complets, traces brutes, secrets ou `.env`. Les champs texte utilisateur sont limités à des previews redacted/compactes.

## Budgets et coûts

Chaque run peut définir :

- `maxToolCalls`
- `maxDurationMs`
- `maxInputTokens`
- `maxOutputTokens`
- `maxTotalTokens`
- `maxEstimatedCost`
- `currency`

Chaque run mesure :

- tool calls utilisés ;
- durée ;
- tokens input/output/total ;
- coût input/output/total ;
- source de mesure : provider/estimated/mixed.

Un dépassement ne doit pas forcément tuer le run immédiatement en V1, mais il doit être détecté et peut mettre le run en `waiting_approval`.

## Approvals

Les approvals sont des objets metadata-only :

- action demandée ;
- capability : write/shell/network/memory/eval/etc. ;
- risk level ;
- reason ;
- decision : pending/approved/denied/expired ;
- decidedBy/decidedAt si applicable.

V1 stocke le mécanisme ; l'intégration interactive complète sera progressive.

## Planner minimal

Le planner V1 ne remplace pas ReAct. Il crée seulement une structure initiale :

1. comprendre objectif et contraintes ;
2. inspecter contexte/repo si nécessaire ;
3. exécuter action minimale ;
4. vérifier ;
5. rapporter résultat et limites.

Pour les tâches simples, il peut produire un plan réduit : comprendre → répondre.

## Intégrations prévues

- **Context Builder** : attacher `context.budget` et suggestions au run.
- **Trace** : stocker `traceRunId` et chemin relatif, pas les événements bruts.
- **Memory** : stocker ids récupérés/proposés/écrits, pas bodies.
- **Subagents** : stocker task ids, rôles, statuts, rapports résumés.
- **Eval** : lier evalRunId/report path metadata-only.
- **Policy** : transformer certains `ask` en approval requests.

## Vérification V1

- `npm run session:smoke` : crée session/run, planifie, enregistre event, approval, metrics, finalise et relit le rapport.
- `npm run eval:session` : eval mock dédiée au contrat Session/Run Manager.
- `npm run typecheck` : intégration TypeScript.

## Intégration progressive actuelle

`NovaAgent.run()` peut maintenant créer automatiquement une session/run si `config.session.enabled === true`. L'intégration V1 :

- crée ou récupère une session ;
- démarre un run avant le Context Builder ;
- enregistre un événement `context_built` ;
- finalise le run en succès/échec avec métriques tokens/coûts, nombre d'appels outils, liens trace/context/memory ;
- ignore silencieusement le Session Manager si la persistance session échoue pour ne pas casser la boucle ReAct.

L'intégration approval interactive complète et le pilotage CLI `nova runs ...` restent V1.1.
