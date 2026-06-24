# Heartbeat / Autonomous Tasks V2 — planification & automatisation (dry-run, désactivé par défaut)

Heartbeat V2 étend la première tranche V1 (ticks de planification **dry-run uniquement**) avec deux commandes purement consultatives — `plan` et `automation export` — sans jamais exécuter de tâche, installer de planificateur, ni appeler de LLM/tool/réseau. Toutes les garanties V1 ci-dessous restent valables verbatim.

> **V3 (Slice 1 — échafaudage *fail-closed*, désactivé par défaut).** Une première tranche V3 ajoute uniquement l'**échafaudage** d'un portail d'exécution à triple porte (`decideHeartbeatExecution`, fonction **pure**, sans I/O ni timer) : **aucune tâche n'est exécutée**. La sonde de sandbox d'exécution (`probeExecutionSandbox()`) renvoie **toujours `null`** pour toute la durée d'ADR-002 (la vraie sandbox arrive en Slice 3). Drapeau maître `NOVA_ENABLE_HEARTBEAT_EXEC` **absent** ⇒ comportement **octet-pour-octet identique à V2** (dry-run, tâche `due`) ; drapeau **présent** et aucune sandbox ⇒ le tick **échoue en sécurité** (`refused`, rien n'est exécuté, `lastRunAt` n'avance jamais). Le schéma d'état heartbeat passe de **1 à 2** (additif, lisible en avant : un état v1 se charge avec les nouveaux champs `undefined` puis est re-tamponné `schemaVersion: 2` à la prochaine écriture). Aucun daemon, planificateur, LLM/tool, réseau ni exécution réelle n'est ajouté. Détails : [`docs/adr/ADR-002-heartbeat-v3.md`](adr/ADR-002-heartbeat-v3.md).

> **V3 (Slice 2 — cycle d'approbation inter-ticks, *OFFLINE*).** La deuxième tranche V3 câble la **Porte B** (approbation) à travers des ticks *single-shot*, sans qu'aucune exécution réelle n'ait lieu : la **Porte C de production reste `null` ⇒ *fail-closed* préservé**. Quand un tick voit une tâche `ok` éligible, il **génère** une approbation synthétique (`hb-appr-<uuid>`), persiste `pendingApprovalId` / `pendingApprovalAt` et s'arrête en `needs_user_action` — **Nova n'appelle jamais `decide`** ; l'opérateur tranche hors-bande. Au **tick suivant** (invoqué de l'extérieur), l'approbation persistée est résolue : `approved` débloque la Porte B (l'exécution réelle reste néanmoins **refusée** tant que la sandbox de production est absente — Slice 3), `denied` ⇒ `blocked` (demande jetée), et une approbation plus vieille que **24 h** ⇒ `expired` ⇒ re-demande (`needs_user_action`) **sans consulter la passerelle**. Une nouvelle commande **lecture seule** `nova heartbeat approvals` liste le registre (`pendingApprovalId` / `lastApprovalId` / `lastExecStatus`) sans jamais écrire l'état ni décider. Drapeau maître absent ⇒ toujours octet-pour-octet identique à V2 (la passerelle n'est même pas consultée). Détails : [`docs/adr/ADR-002-heartbeat-v3.md`](adr/ADR-002-heartbeat-v3.md) §13.

> **V3 (Slice 3 — vraie sandbox d'exécution, *capability-only*, opt-in).** La troisième tranche V3 livre la **vraie sandbox** durcie (sous-processus isolé) qui était stubbée depuis Slice 1 — mais **strictement en capacité** : **aucun appelant dans `src/heartbeat/**` n'invoque `ExecutionSandbox.run()`**, le runner se contente toujours de lire le booléen `available` de la sonde. La sonde `probeExecutionSandbox()` ne renvoie une sandbox vivante que lorsque **`NOVA_ENABLE_EXEC_SANDBOX` est strictement activé** (`"1"` / `"true"`, mêmes sémantiques d'opt-in que les autres drapeaux — **SB1**) **et** que la plateforme est supportée ; sinon elle renvoie **`null`** (Porte C fermée ⇒ *fail-closed*). Conséquence : drapeau maître présent **mais** `NOVA_ENABLE_EXEC_SANDBOX` absent ⇒ tick toujours **`refused`** (identique à Slice 2). Durcissements (contraste avec le `bashTool` interactif) : environnement enfant construit depuis une **allow-list seule** — jamais `process.env` en bloc ; un appelant peut *ajouter* des variables mais **jamais surcharger** `PATH`/`SystemRoot` de base, et les variables d'injection de *loader* (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `NODE_OPTIONS`, `DYLD_*`) sont **rejetées** (**SB2**) ; `cwd` **emprisonné** sous `PROJECT_ROOT` (politique `deniedPathReason`) ; **sans shell** (`shell:false`, métacaractères inertes) ; *timeout* déterministe et **troncature** de sortie combinée (⇒ `exitCode: null`) ; *kill* d'arbre de processus. Le code de *spawn*/timer vit **hors de `src/heartbeat/**`** (dans `src/sandbox/**`) pour ne pas déclencher le garde statique heartbeat. Nouveau smoke isolé : `npm run sandbox:smoke` (9 tests). Le **câblage de l'exécution déléguée réelle** derrière la triple porte est différé en **Slice 4**. Détails : [`docs/adr/ADR-002-heartbeat-v3.md`](adr/ADR-002-heartbeat-v3.md) §14.

## Garanties (V1, préservées en V2)

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
nova heartbeat approvals
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

Types reconnus : `inspection`, `eval`, `batch-dry-run`, `maintenance`. Ils sont seulement planifiés : Heartbeat ne les exécute jamais.

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

#### Cadences représentables (porte unique de cohérence)

Une **porte de cohérence unique** valide la cadence **avant** tout rendu, de façon **identique** pour `cron`, `systemd` et `windows-task` :

- **Acceptées** : `1`–`59` minutes ; heures pleines `60, 120, … 1380` (jusqu'à 23 h, multiples de 60) ; et exactement `1440` (quotidien).
- **Rejetées uniformément** : toute autre valeur (par ex. `90m`, `1439m`, `1500m`) ⇒ **sortie 1** avec un message d'erreur unique, **même si une cible donnée pourrait l'exprimer**. Aucun manifeste n'est rendu ni écrit.

Notes d'horloge et d'export :

- `--at <HH:MM>` exige un format **zéro-padé sur 2 chiffres** (`parseClockHHMM`), p. ex. `09:05` (et non `9:5`).
- `--every 1d` (= `1440` min) exporte un planning **quotidien à `00:00`**.
- Une fenêtre de quiet hours où `start == end` est **inerte** (aucune suppression).
- Pour `cron`, une cadence horaire `60m` s'exporte en `0 */1 * * *` (et non `0 * * * *`).

## Validation

```bash
npm run heartbeat:smoke
npm run eval:heartbeat
```
