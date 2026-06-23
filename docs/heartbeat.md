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

## Planning & Automation (V2)

V2 ajoute deux commandes **purement consultatives**. Elles n'exécutent aucune tâche, n'appellent ni LLM ni tool, ne touchent pas au réseau et **n'installent jamais de planificateur**. Heartbeat reste désactivé par défaut.

### `nova heartbeat plan`

```bash
nova heartbeat plan [--now <iso>] [--horizon <durée>] [--max <n>] [--json]
```

Projection **lecture seule** des occurrences qui *seraient* dues dans l'horizon. La commande ne modifie jamais `.nova/heartbeat/state.json` (octet-pour-octet identique avant/après).

- `--now <iso>` : horloge injectée (ISO-8601). Sans valeur, l'heure courante est utilisée. Fournir `--now` rend la sortie **déterministe**.
- `--horizon <durée>` : fenêtre de projection (`30m`, `6h`, `7d`… ; défaut `6h`).
- `--max <n>` : plafond d'occurrences par tâche (défaut `50`).
- `--json` : sortie JSON report-safe au lieu du résumé humain.

Le `planId` est un sha256 déterministe des entrées (`now`, horizon, max, timezone, digest de config) : entrées identiques ⇒ `planId` identique et occurrences identiques. Chaque plan redacted est persisté sous `.nova/heartbeat/plans/<planId>.{json,md}`. Une tâche `interval` active produit des occurrences `projected` même quand le heartbeat est désactivé (`preview: true`).

### `nova heartbeat automation export`

```bash
nova heartbeat automation export --target <windows-task|systemd|cron> [--every <durée> | --at <HH:MM>] [--stdout] [--out <relpath>] [--json]
```

Génère un **manifeste opérateur inerte** (`installed: false`) que vous pouvez relire puis installer **à la main** si vous le décidez. Le manifeste n'invoque qu'une seule commande lecture seule : `nova heartbeat tick --dry-run`. Il utilise les placeholders `<PROJECT_DIR>` / `<NOVA_BIN>` ; aucun chemin absolu ni secret n'est écrit, et chaque manifeste porte la bannière « Nova does not schedule itself ».

- `--at <HH:MM>` (quotidien) a priorité sur `--every <durée>` (intervalle) ; sans cadence, une valeur par défaut sûre est dérivée de la config.
- `--stdout` imprime le manifeste **sans écrire de fichier**.
- `--out <relpath>` doit rester **sous `.nova/heartbeat/`**. Un chemin qui s'en échappe ⇒ sortie 1, **aucun fichier écrit**, et le message d'erreur ne divulgue aucun chemin absolu.

Sans `--stdout` ni `--out`, le manifeste est écrit sous `.nova/heartbeat/automation/<target>.txt`.

## Validation

```bash
npm run heartbeat:smoke
npm run eval:heartbeat
```
