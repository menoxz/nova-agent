# Approval Manager V1 + CLI runtime minimale

Approval Manager V1 relie la policy, les sessions/runs et le pilotage utilisateur. Son but est simple : lorsqu'une action risquée reçoit une décision `ask`, Nova crée une demande d'approbation persistée et **n'exécute pas** l'action tant qu'aucune approbation explicite n'est fournie.

## Objectifs V1

- Persister les approvals dans les runs sous `.nova/sessions`.
- Lister, approuver ou refuser une approval en attente.
- Préparer le bridge `PolicyDecision.ask -> ApprovalRequest`.
- Exposer des commandes CLI sûres pour sessions/runs/approvals.
- Ne jamais reprendre automatiquement un tool write/shell/network après approval dans cette étape.

## Lifecycle approval

```txt
pending -> approved | denied | expired
```

Une approval contient uniquement des métadonnées sûres : capability, action, tool, risk, raison, ids session/run, timestamps, décision. Elle ne stocke ni prompt complet, ni input tool brut, ni secret.

## Bridge policy/run

Le bridge s'insère comme `ToolRegistry` policy hook :

1. évalue la policy normale ;
2. si décision `ask`, crée une approval dans le run actif ;
3. retourne toujours `ask` ;
4. `ToolRegistry` bloque l'exécution comme avant.

Donc V1 prépare le contrôle humain sans autoriser automatiquement les actions risquées.

## CLI runtime minimale

Commandes sûres, sans appel LLM :

```bash
nova sessions list
nova sessions show <sessionId>
nova runs list [sessionId]
nova runs show <sessionId> <runId>
nova approvals list
nova approvals approve <approvalId> [reason]
nova approvals deny <approvalId> [reason]
```

Ces commandes lisent/modifient uniquement `.nova/sessions` et ne déclenchent aucun outil risqué.

## Limites V1

- Pas de reprise automatique du run après approval.
- Pas de dashboard complet.
- Pas de workflow interactif riche ; la CLI est volontairement minimale.
- Une approval approuvée sert de trace décisionnelle, pas encore de jeton de reprise automatique.
