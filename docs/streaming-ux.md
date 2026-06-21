# Streaming UX V1

Streaming UX V1 ajoute une expérience CLI temps réel sans supprimer le fallback non-streaming.

## UX CLI

En mode streaming, Nova affiche :

- un header de run avec modèle, session/run et estimation du prompt ;
- le texte assistant au fil des tokens ;
- un timer live, tokens de sortie estimés, tokens/seconde et nombre d'outils ;
- des événements outils lisibles avec previews redacted ;
- des blocs thinking/reasoning uniquement si le provider renvoie explicitement du texte de reasoning ;
- un résumé final : durée, usage, coût estimé, outils.

Les blocs thinking sont `collapsed` par défaut. Nova n'invente pas et n'extrait pas de chain-of-thought privée.

## Activation

CLI :

```bash
nova --stream "résume le projet"
nova --no-stream "résume le projet"
```

Variables d'environnement :

```bash
NOVA_STREAMING=true
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

- `src/streaming/types.ts` définit `StreamingConfig`, `AgentRunOptions` et `StreamingEvent`.
- `NovaAgent.run(input, options)` accepte `streaming` et `onEvent`.
- La branche streaming utilise AI SDK `streamText()` avec `onChunk`/`onStepFinish`.
- La branche fallback conserve `generateText()` et retourne toujours `StepDisplay[]`.
- Le renderer CLI `StreamingCliRenderer` consomme les événements et redacted les previews via `redactString`/`redactUnknown`.

Les intégrations context/session/run/approval/trace/conversation/token metrics restent dans `NovaAgent.run` après le résultat final.

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
