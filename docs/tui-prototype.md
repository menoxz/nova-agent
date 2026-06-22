# TUI Prototype V0

TUI Prototype V0 fournit un rendu terminal minimal à partir des logs streaming existants.

## Commande

```bash
nova tui replay <logId>
```

Pour trouver un `logId` :

```bash
nova streaming logs
```

Depuis le dépôt :

```bash
npx tsx src/index.ts tui replay <logId>
```

La commande est read-only et ne nécessite pas `LLM_API_KEY`.

## Source de données

Le TUI V0 réutilise exclusivement les événements existants :

- `RuntimeStreamingEvent` ;
- logs JSONL redacted de `StreamingEventLogStore` ;
- racine par défaut `.nova/streaming/events` ou `NOVA_STREAMING_EVENT_LOG_ROOT`.

Il n'ajoute pas de persistance dédiée.

## Affichage V0

Le rendu est une snapshot terminal textuelle :

- statut : `idle`, `running`, `finished`, `error` ;
- modèle, session/run, timestamps ;
- compteur events, tokens, tools ;
- métriques provider/estimées quand disponibles ;
- tools calls/results avec previews redacted ;
- reasoning collapsed ;
- final answer ou erreur.

## Limites V0

- pas de dashboard web ;
- pas de daemon, scheduler ou queue ;
- pas de batch dashboard complet ;
- pas d'interface interactive plein écran ;
- pas de nouvelle persistance.

## Vérification

```bash
npm run tui:smoke
npm run eval:tui
npm run streaming:log-smoke
npm run typecheck
```
