# Streaming UX V1.1

Streaming UX V1.1 ajoute une expérience CLI temps réel sans supprimer le fallback non-streaming, et formalise une couche d'événements prête pour un futur TUI.

## UX CLI

En mode streaming, Nova affiche :

- un header de run avec modèle, session/run et estimation du prompt ;
- le texte assistant au fil des tokens ;
- un timer live, tokens de sortie estimés, tokens/seconde et nombre d'outils ;
- des événements outils lisibles avec previews redacted ;
- des blocs thinking/reasoning uniquement si le provider renvoie explicitement du texte de reasoning ;
- un résumé final : durée, usage, coût estimé, outils.

Les blocs thinking sont `collapsed` par défaut. Nova n'invente pas et n'extrait pas de chain-of-thought privée.

Modes CLI :

- `compact` : header et summary minimalistes, peu de bruit, adapté scripts/logs ;
- `normal` : rendu lisible par défaut ;
- `verbose` : ajoute détails d'événements et métriques live si stdout est un TTY.

## Activation

CLI :

```bash
nova --stream "résume le projet"
nova --no-stream "résume le projet"
nova --stream-compact "résume le projet"
nova --stream-verbose "résume le projet"
nova --stream-mode=compact --thinking=hidden "résume le projet"
nova --no-stream-metrics --no-stream-tools "résume le projet"
```

Variables d'environnement :

```bash
NOVA_STREAMING=true
NOVA_STREAMING_MODE=normal # compact|normal|verbose
NOVA_STREAMING_SHOW_TOKENS=true
NOVA_STREAMING_SHOW_TOOLS=true
NOVA_STREAMING_SHOW_THINKING=true
NOVA_STREAMING_THINKING_MODE=collapsed # hidden|collapsed|expanded
NOVA_STREAMING_SHOW_METRICS=true
NOVA_STREAMING_SHOW_COST=true
NOVA_STREAMING_REFRESH_MS=250
```

Config projet `.nova/config.json` :

```json
{
  "schemaVersion": 1,
  "streaming": {
    "enabled": true,
    "mode": "normal",
    "showTokens": true,
    "showTools": true,
    "showThinking": true,
    "thinkingMode": "collapsed",
    "showMetrics": true,
    "showCost": true,
    "refreshMs": 250
  }
}
```

## Architecture

- `src/streaming/types.ts` définit `StreamingConfig`, `AgentRunOptions`, `StreamingEventPayload` et `RuntimeStreamingEvent`.
- `src/streaming/events.ts` enveloppe les payloads en événements TUI-ready : `schemaVersion`, `eventId`, `sequence`, `timestamp`, `source`, `severity`, `sessionId`, `runId`.
- `NovaAgent.run(input, options)` accepte `streaming` et `onEvent`.
- La branche streaming utilise AI SDK `streamText()` avec `onChunk`/`onStepFinish`.
- La branche fallback conserve `generateText()` et retourne toujours `StepDisplay[]`.
- Le renderer CLI `StreamingCliRenderer` consomme les événements et redacted les previews via `redactString`/`redactUnknown`.

Les intégrations context/session/run/approval/trace/conversation/token metrics restent dans `NovaAgent.run` après le résultat final.

## Event layer TUI-ready

Chaque événement streaming est un objet discriminé et séquencé. Le CLI consomme aujourd'hui ces événements, et un futur TUI pourra réutiliser le même flux sans relire stdout.

Exemple simplifié :

```json
{
  "schemaVersion": 1,
  "eventId": "evt_xxx_1",
  "sequence": 1,
  "timestamp": "2026-06-21T00:00:00.000Z",
  "source": "llm",
  "severity": "info",
  "sessionId": "...",
  "runId": "...",
  "type": "token",
  "text": "Bonjour",
  "completionTokens": 2,
  "elapsedMs": 120
}
```

## Sécurité

- Pas de stockage de raw prompts, secrets, traces ou inputs outils via Streaming UX.
- Les previews outil sont bornées et redacted.
- Thinking/reasoning affiché seulement si le provider le fournit explicitement.
- `.env`, `.nova`, raw traces/evals et secrets restent hors affichage volontaire et hors versioning.

## Validation

```bash
npm run streaming:smoke
npm run streaming:agent-smoke
npm run eval:streaming
npm run typecheck
```
