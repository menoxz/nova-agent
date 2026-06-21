# Context Builder V1 — plan définitif

Context Builder V1 transforme la mémoire Nova en composant explicite du contexte agent. Son rôle n'est pas de tout injecter, mais de composer le minimum de contexte utile, sûr et justifié avant chaque appel LLM.

## Objectifs V1

- Injecter uniquement les informations nécessaires à la requête courante.
- Séparer les sources par autorité : système, mémoire utilisateur/entreprise éditable, mémoire projet récupérée, capacités disponibles, budget.
- Rendre le coût token visible et justifié bloc par bloc.
- Garder les contenus sensibles hors contexte : secrets, `.env`, traces brutes, rapports `.nova`, logs volumineux.
- Tracer uniquement des métadonnées de contexte : ids, counts, coûts estimés, raisons, omissions.

## Sources de contexte

| Source | Injection V1 | Autorité | Règle |
|---|---:|---|---|
| Système stable / profil actif | Toujours | trusted_system | Base prompt + règles + policy. |
| Mémoire utilisateur / entreprise | Si retrieval pertinent | user_editable | Déclaratif, éditable, prioritaire sur mémoire inférée mais jamais au-dessus du système/policy. |
| Mémoire projet | Si retrieval pertinent | untrusted_retrieved | Décisions/procédures utiles, toujours marquées non fiables. |
| Capacités tools/skills/MCP | Compacte, si activée | capability_metadata | Liste courte et pertinente, pas catalogue complet ni contenu complet de skills. |
| Budget report | Par défaut | budget_metadata | Explique coût, nécessité et omissions. |

## Mémoire utilisateur / entreprise éditable

Collections dédiées :

- `user_profile`
- `user_preferences`
- `organization_profile`
- `organization_policies`
- `organization_stack`
- `organization_glossary`
- `organization_constraints`

Ces collections sont mises à jour via `upsertEditableUserOrgMemory`, listées via `listEditableUserOrgMemory`, et supprimées via `deleteEditableUserOrgMemory`. Chaque entrée reçoit un tag stable `key:<clé>` pour permettre une mise à jour explicite sans dupliquer. Les anciennes valeurs sont archivées avant remplacement.

## Politique d'injection

### Toujours présent

- Prompt système et profil agent.
- Règles d'usage des outils.
- Instructions de hiérarchie : contexte dynamique ≠ instruction supérieure.

### Injecté seulement si utile

- Mémoire user/org correspondant à la requête.
- Mémoire projet correspondant à la requête.
- Outils, skills et MCP sélectionnés par pertinence.

### Jamais injecté automatiquement

- Secrets, tokens, clés API.
- `.env`, `.git`, `node_modules`.
- Traces/evals/reports bruts sous `.nova`.
- Logs volumineux ou dumps complets.
- Mémoire à risque prompt-injection non approuvée/non vérifiée.

## Budget token et justification

V1 utilise une estimation locale simple : `ceil(chars / 4)`. Ce n'est pas un tokenizer exact, mais c'est stable, déterministe et suffisant pour contrôler la taille relative des blocs.

Budgets par défaut :

- budget dynamique total : `1800` tokens estimés ;
- mémoire user/org : `350` ;
- mémoire projet : `700` ;
- capacités : `450`.

Chaque bloc porte :

- `estimatedTokens` ;
- `included` ;
- `reason` ;
- `omittedReason` si exclu.

Le prompt reçoit un bloc `<context_budget>` qui justifie le coût comme nécessaire uniquement quand le bloc apporte une valeur contextuelle : préférence utilisateur, contrainte entreprise, décision projet, capacité d'action pertinente.

## Format d'injection

```xml
<user_organization_memory trusted="user_editable">
...
</user_organization_memory>

<retrieved_memory_untrusted source="nova-memory">
...
</retrieved_memory_untrusted>

<available_capabilities trust="capability_metadata">
...
</available_capabilities>

<context_budget max_tokens="..." used_tokens="...">
...
</context_budget>
```

## Implémentation V1

Modules :

- `src/context/builder.ts` : orchestration du contexte dynamique.
- `src/context/budget.ts` : estimation et packing budget.
- `src/tokens/` : estimation, extraction d'usage provider, vitesse tokens/seconde, compaction.
- `src/context/selectors/memory.ts` : retrieval user/org et projet.
- `src/context/selectors/capabilities.ts` : résumé compact tools/skills/MCP.
- `src/context/prompt.ts` : assemblage prompt + budget report.
- `src/memory/editable_store.ts` : mémoire user/org éditable.

`NovaAgent.run()` utilise maintenant `buildAgentContext()` au lieu d'injecter directement toute la mémoire récupérée. Les traces reçoivent `context` et `memory` comme métadonnées seulement.

## Vérification

- `npm run context:smoke` vérifie : user/org memory, mémoire projet non fiable, capacités, budget, justifications, omissions.
- `npm run eval:context` ajoute une couverture eval mock.
- `npm run typecheck` garantit l'intégration TypeScript.

Voir aussi [`token-management.md`](token-management.md) pour la mesure token, la compaction et le scoring d'auto-suggestion skills/MCP.
