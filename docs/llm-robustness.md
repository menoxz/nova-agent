# LLM Robustness V1

Pour les erreurs de provider/model ou d'endpoint, commencer par `nova providers doctor` et `nova providers show <id>` afin de vérifier le profil, le protocole, la base URL, le modèle et la présence de `LLM_API_KEY` sans afficher la clé.

LLM Robustness V1 fiabilise les appels modèle sans changer automatiquement de provider ou de modèle.

## Fonctionnalités

- timeout configurable pour `generateText()` et `streamText()` ;
- retries/backoff contrôlés pour les appels non-streaming ;
- `streamText()` protégé par timeout, mais sans retry externe après démarrage afin d'éviter la duplication de tokens/tools ;
- classification des erreurs provider ;
- diagnostics CLI/streaming redacted et exploitables.

## Config

Variables d'environnement :

```bash
NOVA_LLM_TIMEOUT_MS=60000
NOVA_LLM_RETRIES=1
NOVA_LLM_RETRY_BACKOFF_MS=750
NOVA_LLM_RETRY_BACKOFF_MULTIPLIER=2
```

Config projet :

```json
{
  "llm": {
    "robustness": {
      "timeoutMs": 60000,
      "retries": 1,
      "retryBackoffMs": 750,
      "retryBackoffMultiplier": 2
    }
  }
}
```

Defaults sûrs : timeout 60s, 1 retry, backoff 750ms, multiplicateur 2, retries capés à 5.

## Classification

Types d'erreurs :

- `auth` : 401/403, clé invalide, accès refusé — non retryable ;
- `rate_limit` : 429/quota — retryable ;
- `timeout` : AbortError/timeout — retryable ;
- `endpoint_incompatible` : 404/route not found/endpoint mismatch — non retryable ;
- `network` : DNS/socket/TLS/fetch failed — retryable ;
- `provider_5xx` : erreurs 5xx provider — retryable ;
- `unknown` : fallback — non retryable par défaut.

## Diagnostics CLI

Format synthétique :

```txt
LLM endpoint_incompatible status=404 provider=openmodel/deepseek-v4-flash endpoint=https://api.../v1: LLM endpoint appears incompatible ...
```

Les messages sont redacted via les règles policy existantes.

## Streaming

En streaming, Nova passe `abortSignal`, `timeout` et `maxRetries=0` à l'AI SDK. Les retries externes sont désactivés pour éviter de rejouer partiellement une réponse streamée ou des tools.

## Validation

```bash
npm run llm:smoke
npm run eval:llm
npm run typecheck
```
