# Heartbeat / Autonomous Tasks V1 — première tranche sûre

Heartbeat V1 ajoute une planification locale **dry-run uniquement** pour préparer de futures tâches autonomes sans les exécuter.

## Garanties V1

- Désactivé par défaut (`heartbeat.enabled` absent ou `false`).
- Aucun daemon, cron, service Windows/systemd ou boucle long-running.
- Aucun appel LLM, aucun `NovaAgent`, aucun tool et aucune action autonome réelle.
- Les actions dangereuses (`shell`, `write`, `git`, `network`, `memory-write`, `auto-resume`) sont `blocked`.
- Les actions non supportées sont `blocked` ou `needs_user_action` avec raison claire.
- Rapports metadata-only/redacted sous `.nova/heartbeat` uniquement.
- La config heartbeat rejette les valeurs secret-like et les ids de tâches dupliqués.
- Les sorties CLI, JSON, Markdown et `report latest` passent par une redaction report-safe centralisée; `report latest` redacted aussi les anciens rapports non sûrs avant affichage.

## CLI

```bash
nova heartbeat --help
nova heartbeat validate
nova heartbeat status
nova heartbeat tasks
nova heartbeat tick --dry-run
nova heartbeat report latest
```

`tick --dry-run` calcule les tâches `due`, `skipped`, `blocked` et `needs_user_action`, écrit un JSON et un Markdown report-safe dans `.nova/heartbeat/ticks/`, puis met à jour `.nova/heartbeat/state.json`. Un lock minimal `.nova/heartbeat/locks/heartbeat.lock` empêche deux ticks simultanés et est supprimé en `finally`, y compris après erreur contrôlée.

## Configuration

Exemple `.nova/config.json` :

```json
{
  "schemaVersion": 1,
  "heartbeat": {
    "enabled": false,
    "tasks": [
      {
        "id": "inspect-docs",
        "kind": "inspection",
        "action": "inspect",
        "schedule": { "type": "interval", "everyMinutes": 60 }
      },
      {
        "id": "manual-eval",
        "kind": "eval",
        "action": "eval",
        "schedule": { "type": "manual" }
      }
    ]
  }
}
```

Types reconnus : `inspection`, `eval`, `batch-dry-run`, `maintenance`. Ils sont seulement planifiés : V1 ne les exécute jamais.

Les champs `id`, `name`, `kind`, `action`, `reason` et les chemins de rapport sont redacted au moment des sorties/rapports. L'état interne peut conserver les ids validés nécessaires à la planification, mais les contenus secret-like sont rejetés dès la lecture de `.nova/config.json`.

## Validation

```bash
npm run heartbeat:smoke
npm run eval:heartbeat
```
