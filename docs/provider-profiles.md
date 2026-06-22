# Provider Profiles / Fallback contrôlé V1

Provider Profiles V1 rend la configuration LLM explicite, diagnostiquable et sûre. Les profils décrivent uniquement des métadonnées non secrètes : provider adapter, base URL, modèle et protocole attendu.

Provider Directory V1.1 ajoute en plus un catalogue metadata-only de tous les providers opencode listés par l'utilisateur. Une entrée Directory peut être planned ou gateway/subscription/token-plan sans être exécutable par Nova aujourd'hui.

## Commandes read-only

```bash
nova providers list
nova providers show openmodel-deepseek-v4-flash
nova providers show github-copilot
nova providers doctor
nova --provider-profile openmodel-deepseek-v4-flash providers doctor
```

Ces commandes ne nécessitent pas `LLM_API_KEY`, ne créent pas `NovaAgent`, ne déclenchent aucun appel LLM et n'exécutent aucun tool.

`doctor` affiche seulement si `LLM_API_KEY` est `present` ou `missing`; la valeur de la clé n'est jamais affichée.

Pour préparer un futur live smoke sans l'exécuter, utiliser le plan offline/mock-only [`provider-live-smoke-readiness.md`](provider-live-smoke-readiness.md) et `npm run providers:readiness-smoke`.

## Provider Profiles vs Provider Directory

| Concept | Rôle | Exécutable runtime ? |
| --- | --- | --- |
| Provider Profile | Profil provider/model concret utilisé par `loadConfig()` : provider adapter, base URL, modèle, protocole. | Oui, seulement si l'adapter Nova existe et qu'une clé valide est fournie. |
| Provider Directory | Catalogue metadata-only inspiré opencode : providers populaires, gateways, plans, SDKs futurs, custom providers. | Pas nécessairement. Les entrées `planned`, `gateway-subscription-token-plan` et `custom-other` ne sont pas prétendues exécutables. |

Catégories Directory :

- `runtime-supported` : adapter Nova actuel avec profils associés (`openrouter`, `openmodel`, `openai`, `anthropic`, `deepseek`).
- `openai-compatible` : probablement utilisable via endpoint OpenAI-compatible explicite, mais non profilé comme adapter dédié.
- `anthropic-compatible` : endpoint compatible Anthropic/messages à intégrer explicitement.
- `planned` : provider présent côté opencode mais nécessite SDK/options/adapters futurs côté Nova.
- `gateway-subscription-token-plan` : gateway, abonnement, token plan ou fournisseur avec auth spécifique; metadata-only côté Nova.
- `custom-other` : extension utilisateur/custom provider.

Stratégie progressive : le Directory permet de voir tous les providers opencode sans fetch distant ni secrets. Les entrées migrent vers Provider Profile puis vers runtime support uniquement quand le protocole, l'auth et les tests sans secrets sont maîtrisés.

## Profils intégrés V1

Le catalogue intégré reprend la structure opencode observée localement : `providerID/modelID`, priorités de modèles (`gpt-5`, `claude-sonnet-4`, `gemini-3-pro`) et petits modèles (`claude-haiku-4.5`, `gemini-2.5-flash`, `gpt-5-mini`). Nova garde toutefois une surface volontairement limitée aux adapters déjà supportés par son client LLM V1 (`openrouter`, `openmodel`, `openai`, `anthropic`, `deepseek`). Les providers opencode nécessitant des SDK/options additionnels (`google`, `mistral`, `groq`, `xai`, etc.) sont exposés via OpenRouter quand un modèle utile existe, au lieu d'ajouter de nouveaux clients non implémentés.

| ID | Provider | Base URL | Modèle | Protocole |
| --- | --- | --- | --- | --- |
| `openrouter-deepseek-v4-flash` | `openrouter` | `https://openrouter.ai/api/v1` | `openmodel/deepseek-v4-flash` | OpenAI-compatible chat completions |
| `openrouter-openai-gpt-5` | `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-5` | OpenAI-compatible chat completions |
| `openrouter-openai-gpt-5-mini` | `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-5-mini` | OpenAI-compatible chat completions |
| `openrouter-openai-gpt-5-chat` | `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-5-chat` | OpenAI-compatible chat completions |
| `openrouter-openai-gpt-5-5` | `openrouter` | `https://openrouter.ai/api/v1` | `openai/gpt-5.5` | OpenAI-compatible chat completions |
| `openrouter-anthropic-claude-sonnet-4` | `openrouter` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` | OpenAI-compatible chat completions |
| `openrouter-anthropic-claude-haiku-4-5` | `openrouter` | `https://openrouter.ai/api/v1` | `anthropic/claude-haiku-4.5` | OpenAI-compatible chat completions |
| `openrouter-google-gemini-3-pro-preview` | `openrouter` | `https://openrouter.ai/api/v1` | `google/gemini-3-pro-preview` | OpenAI-compatible chat completions |
| `openrouter-google-gemini-2-5-flash` | `openrouter` | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` | OpenAI-compatible chat completions |
| `openrouter-deepseek-v4-pro` | `openrouter` | `https://openrouter.ai/api/v1` | `deepseek/deepseek-v4-pro` | OpenAI-compatible chat completions |
| `openrouter-qwen-plus` | `openrouter` | `https://openrouter.ai/api/v1` | `qwen/qwen-plus` | OpenAI-compatible chat completions |
| `openrouter-mistral-large` | `openrouter` | `https://openrouter.ai/api/v1` | `mistralai/mistral-large-3-675b-instruct-2512` | OpenAI-compatible chat completions |
| `openrouter-groq-llama-3-3-70b` | `openrouter` | `https://openrouter.ai/api/v1` | `groq/llama-3.3-70b-versatile` | OpenAI-compatible chat completions |
| `openmodel-deepseek-v4-flash` | `openmodel` | `https://api.openmodel.ai/v1` | `deepseek-v4-flash` | Anthropic-compatible messages |
| `openmodel-kimi-k2-5-free` | `openmodel` | `https://api.openmodel.ai/v1` | `kimi-k2.5-free` | Anthropic-compatible messages |
| `openai-gpt-4o-mini` | `openai` | `https://api.openai.com/v1` | `gpt-4o-mini` | OpenAI-compatible chat completions |
| `openai-gpt-5` | `openai` | `https://api.openai.com/v1` | `gpt-5` | OpenAI-compatible chat completions |
| `openai-gpt-5-mini` | `openai` | `https://api.openai.com/v1` | `gpt-5-mini` | OpenAI-compatible chat completions |
| `openai-gpt-4-1-mini` | `openai` | `https://api.openai.com/v1` | `gpt-4.1-mini` | OpenAI-compatible chat completions |
| `anthropic-claude-sonnet` | `anthropic` | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` | Anthropic-compatible messages |
| `anthropic-claude-sonnet-4-5` | `anthropic` | `https://api.anthropic.com/v1` | `claude-sonnet-4-5-20250929` | Anthropic-compatible messages |
| `anthropic-claude-haiku-4-5` | `anthropic` | `https://api.anthropic.com/v1` | `claude-haiku-4-5-20251001` | Anthropic-compatible messages |
| `deepseek-chat` | `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` | OpenAI-compatible chat completions |
| `deepseek-v4-pro` | `deepseek` | `https://api.deepseek.com/v1` | `deepseek-v4-pro` | OpenAI-compatible chat completions |

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
npm run providers:readiness-smoke
npm run eval:providers
npm run eval:provider-readiness
npm run check:fast
```
