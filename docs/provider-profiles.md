# Provider Profiles / Fallback contrôlé V1

Provider Profiles V1 rend la configuration LLM explicite, diagnostiquable et sûre. Les profils décrivent uniquement des métadonnées non secrètes : provider adapter, base URL, modèle et protocole attendu.

## Commandes read-only

```bash
nova providers list
nova providers show openmodel-deepseek-v4-flash
nova providers doctor
nova --provider-profile openmodel-deepseek-v4-flash providers doctor
```

Ces commandes ne nécessitent pas `LLM_API_KEY`, ne créent pas `NovaAgent`, ne déclenchent aucun appel LLM et n'exécutent aucun tool.

`doctor` affiche seulement si `LLM_API_KEY` est `present` ou `missing`; la valeur de la clé n'est jamais affichée.

## Profils intégrés V1

| ID | Provider | Base URL | Modèle | Protocole |
| --- | --- | --- | --- | --- |
| `openrouter-deepseek-v4-flash` | `openrouter` | `https://openrouter.ai/api/v1` | `openmodel/deepseek-v4-flash` | OpenAI-compatible chat completions |
| `openmodel-deepseek-v4-flash` | `openmodel` | `https://api.openmodel.ai/v1` | `deepseek-v4-flash` | Anthropic-compatible messages |
| `openai-gpt-4o-mini` | `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` | OpenAI-compatible chat completions |
| `anthropic-claude-sonnet` | `anthropic` | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` | Anthropic-compatible messages |
| `deepseek-chat` | `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` | OpenAI-compatible chat completions |

## Précédence

1. CLI explicite : `--provider-profile <id>` et `--provider-fallback <id1,id2>`.
2. Variables d'environnement : `NOVA_PROVIDER_PROFILE` / `NOVA_LLM_PROVIDER_PROFILE`, puis `NOVA_PROVIDER_FALLBACK` / `NOVA_LLM_FALLBACK`.
3. `.nova/config.json` : `llm.providerProfile` et `llm.fallbackProfiles`.
4. Default intégré : `openrouter-deepseek-v4-flash`.

Les overrides historiques `LLM_PROVIDER`, `LLM_BASE_URL` et `LLM_MODEL` restent supportés et gagnent sur les valeurs du profil quand le profil vient de l'env, de la config ou du default. Un `--provider-profile` CLI explicite sélectionne le profil exact.

## Fallback contrôlé

Le fallback provider/model est uniquement une configuration opt-in explicite :

```bash
nova --provider-profile openmodel-deepseek-v4-flash \
  --provider-fallback openrouter-deepseek-v4-flash,openai-gpt-4o-mini \
  "résume le projet"
```

ou :

```env
NOVA_PROVIDER_PROFILE=openmodel-deepseek-v4-flash
NOVA_PROVIDER_FALLBACK=openrouter-deepseek-v4-flash,openai-gpt-4o-mini
```

Nova V1 ne fait pas de bascule automatique silencieuse. La configuration fallback est exposée dans `providers doctor` et disponible au runtime comme métadonnée, mais aucun appel provider externe ni retry multi-provider caché n'est introduit par ce module.

## Exemple `.nova/config.json`

```json
{
  "schemaVersion": 1,
  "llm": {
    "providerProfile": "openmodel-deepseek-v4-flash",
    "fallbackProfiles": ["openrouter-deepseek-v4-flash"],
    "robustness": { "timeoutMs": 60000, "retries": 1 }
  }
}
```

Ne jamais stocker `apiKey`, token, password ou secret dans `.nova/config.json`. Garder la clé dans `.env` ou l'environnement système :

```env
LLM_API_KEY=...
```

## Troubleshooting rapide

- `endpoint_incompatible` / `route not found` : vérifier que le profil correspond au protocole attendu (`anthropic-messages` vs `openai-chat-completions`).
- `auth` : vérifier uniquement la présence de `LLM_API_KEY`; ne jamais copier la clé dans les logs ou docs.
- `providers doctor` avec `apiKey.status=missing` : les commandes read-only restent disponibles, mais les exécutions LLM réelles échoueront tant que la clé est absente.
- Profil inconnu : lancer `nova providers list` puis corriger `--provider-profile`, `NOVA_PROVIDER_PROFILE` ou `.nova/config.json`.

## Vérification

```bash
npm run providers:smoke
npm run eval:providers
npm run check:fast
```
