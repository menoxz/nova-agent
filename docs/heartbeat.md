# Heartbeat / Autonomous Tasks V1 — première tranche sûre

Heartbeat V1 ajoute une planification locale **dry-run uniquement** pour préparer de futures tâches autonomes sans les exécuter.

## Garanties V1

- Désactivé par défaut (`heartbeat.enabled` absent ou `false`).
- Aucun daemon, cron, service Windows/systemd ou boucle long-running.
- Aucun appel LLM, aucun `NovaAgent`, aucun tool et aucune action autonome réelle.
- Les actions dangereuses (`shell`, `write`, `git`, `network`, `memory-write`, `auto-resume`) sont `blocked`.
- Les actions non supportées sont `blocked` ou `needs_user_action` avec raison claire.
- Rapports metadata-only/redacted sous `.nova/heartbeat` uniquement.

## CLI

```bash
nova heartbeat --help
nova heartbeat validate
nova heartbeat status
nova heartbeat tasks
nova heartbeat tick --dry-run
nova heartbeat report latest
```

`tick --dry-run` calcule les tâches `due`, `skipped`, `blocked` et `needs_user_action`, écrit un JSON et un Markdown dans `.nova/heartbeat/ticks/`, puis met à jour `.nova/heartbeat/state.json`. Un lock minimal `.nova/heartbeat/locks/heartbeat.lock` empêche deux ticks simultanés et est supprimé en `finally`.

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

## Validation

```bash
npm run heartbeat:smoke
npm run eval:heartbeat
```
