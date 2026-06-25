# Token Management V1 + auto-suggestion skills/MCP

Ce plan complète Context Builder V1 avec une couche de mesure token, vitesse de réponse, compaction et scoring des capacités.

## Objectifs

- Estimer le coût token quand le provider ne fournit pas d'usage exact.
- Capturer l'usage provider quand il est disponible (`usage`, `totalUsage`, variantes `promptTokens/inputTokens`, `completionTokens/outputTokens`).
- Calculer la vitesse de réponse en tokens/seconde sur les tokens de completion.
- Estimer le coût dépensé à partir des tokens et d'une configuration de pricing locale.
- Compacter les blocs de contexte trop gros avant omission complète.
- Définir une base explicite de scoring pour auto-suggérer skills/MCP.

## Mesure et estimation

V1 utilise `ceil(chars / 4)` comme estimation locale déterministe. La source est tracée :

- `provider` si l'API retourne prompt/completion/total tokens ;
- `estimated` si Nova estime tout ;
- `mixed` si une partie vient du provider et le reste est estimé.

Les traces ajoutent :

- `promptTokens`
- `completionTokens`
- `totalTokens`
- `responseDurationMs`
- `responseTokensPerSecond`
- `tokenMeasurementSource`
- `inputCost`, `outputCost`, `totalCost`
- `costCurrency`, `pricingSource`, `pricingUnit`

## Coût estimé

Nova ne suppose pas connaître les tarifs exacts de tous les providers. Le pricing est configurable localement :

- `LLM_PRICING_CURRENCY`, défaut `USD` ;
- `LLM_INPUT_COST_PER_1M_TOKENS` ;
- `LLM_OUTPUT_COST_PER_1M_TOKENS` ;
- `LLM_PRICING_SOURCE`, par exemple `env`, `provider-docs-2026-06`, `contract-enterprise`.

Calcul :

```txt
inputCost = promptTokens / 1_000_000 * inputCostPer1MTokens
outputCost = completionTokens / 1_000_000 * outputCostPer1MTokens
```

Le coût reste marqué comme estimation, même si les tokens viennent du provider, car les remises, minimums de facturation, cache discounts ou contrats privés ne sont pas garantis par Nova.

## Compaction

Avant d'omettre un bloc, le Context Builder tente une compaction si le budget restant est suffisant. La compaction conserve le début du bloc, une éventuelle fin courte, puis ajoute un marqueur :

```txt
[... compacted N lines to fit token budget: context_budget_exceeded ...]
```

Chaque bloc compacté trace :

- `originalEstimatedTokens`
- `estimatedTokens`
- `compacted: true`
- `compactedReason`
- `omittedReason`

## Auto-suggestion skills/MCP

Les suggestions ne sont pas basées sur de la magie : elles viennent d'un score déterministe calculé depuis :

1. termes de la requête utilisateur ;
2. `name`, `description`, `tags` ;
3. `triggers` explicites ;
4. priorité optionnelle `priority` ;
5. statut MCP (`connected` ajoute un léger bonus).

Score simplifié :

- +1 par terme de requête retrouvé dans les métadonnées ;
- +2 par trigger correspondant ;
- +1 si un tag correspond ;
- +`priority` si définie ;
- +0.5 pour MCP connecté.

Injection :

- seulement si `score >= suggestionThreshold` ;
- limitée par `maxSkillSuggestions` / `maxMcpSuggestions` ;
- limitée par `capabilityTokenBudget` ;
- injectée comme metadata de capacité, jamais comme instruction obligatoire.

Le bloc `<context_budget>` liste les suggestions avec score, matches et statut `injected`.

## Configuration

- `NOVA_CONTEXT_SUGGESTION_THRESHOLD`
- `NOVA_CONTEXT_MAX_SKILL_SUGGESTIONS`
- `NOVA_CONTEXT_MAX_MCP_SUGGESTIONS`
- `NOVA_CONTEXT_TOKEN_BUDGET`
- `NOVA_CONTEXT_*_TOKEN_BUDGET`

## CLI estimator / doctor

Token Management V1.1 exposes local-only CLI commands:

```bash
nova tokens estimate "texte à estimer"
nova tokens compact "long texte" --budget 120
nova tokens doctor
```

- `estimate` uses the deterministic `ceil(chars / 4)` estimator and optionally returns estimated cost when `LLM_INPUT_COST_PER_1M_TOKENS` / `LLM_OUTPUT_COST_PER_1M_TOKENS` are configured.
- `compact` applies the same deterministic compaction marker used by Context Builder.
- `doctor` verifies estimator, pricing parsing, compaction, and local-only safety metadata.

These commands do not call an LLM, execute tools, read `.env` directly, or write files.

## Vérification

- `npm run tokens:smoke`
- `npm run context:smoke`
- `npm run eval:tokens`
- `npm run eval:context`
