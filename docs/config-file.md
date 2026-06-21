# Config File V1

Config File V1 centralise les defaults projet/runtime de Nova dans un fichier local sûr :

```txt
.nova/config.json
```

Ce fichier est optionnel. S'il est absent, Nova conserve les defaults intégrés et les variables d'environnement existantes.

## Exemple

```json
{
  "schemaVersion": 1,
  "profile": "nova.builder",
  "session": {
    "enabled": true,
    "autoCreate": true,
    "title": "Nova local work",
    "tags": ["local"],
    "conversation": { "enabled": true }
  },
  "policy": { "profileId": "developer" },
  "llm": {
    "robustness": {
      "timeoutMs": 60000,
      "retries": 1,
      "retryBackoffMs": 750,
      "retryBackoffMultiplier": 2
    }
  },
  "context": {
    "enabled": true,
    "tokenBudget": 4000,
    "includeConversationSummary": true
  },
  "streaming": {
    "enabled": true,
    "mode": "normal",
    "showTokens": true,
    "showTools": true,
    "showThinking": true,
    "thinkingMode": "collapsed",
    "showMetrics": true,
    "showCost": true,
    "eventLog": {
      "enabled": false,
      "root": ".nova/streaming/events",
      "includeText": true,
      "maxTextChars": 2000,
      "maxEvents": 20000
    }
  },
  "memory": { "enabled": true },
  "runs": {
    "maxToolCalls": 20,
    "maxTotalTokens": 120000,
    "maxEstimatedCost": 1,
    "currency": "USD"
  }
}
```

## Commandes CLI

```bash
nova config show
nova config init
nova config validate
nova config explain
```

- `show` affiche la config projet et la config runtime sanitisée.
- `init` crée `.nova/config.json` avec un template sûr et refuse d'écraser par défaut.
- `validate` vérifie le schéma strict et les règles de sécurité.
- `explain` décrit les effets du fichier et la précédence.

Ces commandes fonctionnent sans clé LLM.

## Précédence

Config File V1 applique une règle simple :

1. CLI explicite, par exemple `--profile`, gagne.
2. Variables d'environnement existantes gagnent.
3. `.nova/config.json` fournit les defaults projet.
4. Defaults intégrés Nova en dernier recours.

Cela évite de casser les workflows `.env` existants.

## Sécurité

`.nova/config.json` ne doit jamais contenir de secrets :

- pas de `apiKey` ;
- pas de `password` ;
- pas de `token` ;
- pas de `authorization` ;
- pas de private key ;
- pas de credential URL.

Le loader rejette les clés et valeurs secret-like. Les clés LLM restent dans `.env` ou l'environnement système.

## Champs supportés V1

- `profile`
- `maxSteps`
- `llm.provider/baseUrl/model/maxTokens/pricing/robustness` — jamais `apiKey`
- `policy.enabled/profileId`
- `trace.*`
- `context.*`
- `streaming.enabled/mode/showTokens/showTools/showThinking/thinkingMode/showMetrics/showCost/refreshMs/eventLog.*`
- `memory.*`
- `session.*`
- `session.conversation.*`
- `runs.*`
- `toolConstraints.allowed/denied/presets`

Le schéma est strict : les champs inconnus sont refusés.

## Validation

```bash
npm run config:smoke
npm run llm:smoke
npm run streaming:smoke
npm run streaming:agent-smoke
npm run streaming:log-smoke
npm run eval:config
```
