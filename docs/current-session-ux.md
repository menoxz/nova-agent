# Current Session UX V1

Current Session UX V1 évite de copier-coller les ids de session/run pour les opérations quotidiennes.

## Pointeur courant

Nova maintient un pointeur local metadata-only :

```txt
.nova/sessions/_current.json
```

Format :

```json
{
  "schemaVersion": 1,
  "sessionId": "ses_...",
  "runId": "run_...",
  "updatedAt": "...",
  "source": "cli",
  "safety": {
    "metadataOnly": true,
    "secretsIncluded": false,
    "rawPromptsIncluded": false,
    "rawToolInputsIncluded": false
  }
}
```

Le fichier ne contient aucun prompt brut, input tool brut, trace brute, secret ou rapport `.nova` brut.

## Commandes sessions

```bash
nova sessions current
nova sessions use <sessionId>
nova sessions unset-current
```

- `current` affiche le pointeur courant ou `null`.
- `use` valide que la session existe et la définit comme courante.
- `unset-current` supprime uniquement le pointeur, sans supprimer de session/run/conversation.

## Commandes runs

```bash
nova runs current
nova runs report-current
nova runs resume-current [reason]
```

- `current` affiche le run courant si `runId` est disponible.
- `report-current` produit le même rapport metadata-only que `runs report <sessionId> <runId>`.
- `resume-current` crée un run enfant planifié via Run Resume V1 et met le pointeur courant sur ce run enfant.

## Commandes conversations avec ID optionnel

Ces commandes acceptent toujours un `<sessionId>`, mais utilisent la session courante s'il est omis :

```bash
nova conversations show [sessionId]
nova conversations summary [sessionId]
nova conversations compact [sessionId]
```

## Mises à jour automatiques

Le pointeur courant est mis à jour quand :

- un run NovaAgent démarre ;
- `nova sessions use <sessionId>` est appelé ;
- `nova runs resume` ou `nova runs resume-current` crée un run enfant.

## Sécurité V1

- Pas de config globale.
- Pas de backend externe.
- Pas de clear/destruction conversationnelle.
- Pas d'appel LLM par les commandes runtime current.
- Pas de ré-exécution automatique d'action risquée.

## Validation

```bash
npm run current:smoke
npm run eval:current
```
