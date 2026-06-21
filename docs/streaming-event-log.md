# Streaming Event Log / Replay V1

Event Log / Replay V1 persiste les `RuntimeStreamingEvent` en JSONL redacted afin de permettre une lecture/replay CLI sans appeler LLM ni tools.

## Stockage

Par défaut :

```txt
.nova/streaming/events/<sessionId>/<runId>.jsonl
```

Si aucun session/run n'est disponible :

```txt
.nova/streaming/events/standalone/<logId>.jsonl
```

Chaque ligne est un `StreamingEventLogRecord` :

- `schemaVersion: 1`
- `event: RuntimeStreamingEvent`
- `persistedAt`
- `safety.redacted=true`
- `rawPromptsIncluded=false`
- `rawToolInputsIncluded=false`
- `secretsIncluded=false`

## Sécurité

- Les événements sont redacted via `redactUnknown`/`redactString`.
- Les previews outils sont bornées.
- `includeText=false` remplace les tokens/réponses/reasoning par des placeholders.
- Le replay ne ré-exécute rien : lecture JSONL uniquement.

## CLI

```bash
nova streaming logs
nova streaming show <logId>
nova streaming replay <logId>
```

Ces commandes fonctionnent sans clé LLM et ne construisent pas de tools.

## Config

```json
{
  "streaming": {
    "eventLog": {
      "enabled": true,
      "root": ".nova/streaming/events",
      "includeText": true,
      "maxTextChars": 2000,
      "maxEvents": 20000
    }
  }
}
```

Variables d'environnement :

```bash
NOVA_STREAMING_EVENT_LOG=true
NOVA_STREAMING_EVENT_LOG_ROOT=.nova/streaming/events
NOVA_STREAMING_EVENT_LOG_INCLUDE_TEXT=true
NOVA_STREAMING_EVENT_LOG_MAX_TEXT_CHARS=2000
NOVA_STREAMING_EVENT_LOG_MAX_EVENTS=20000
```

## Validation

```bash
npm run streaming:log-smoke
npm run streaming:agent-smoke
npm run eval:streaming
```
