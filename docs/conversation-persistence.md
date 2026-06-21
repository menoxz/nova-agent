# Conversation Persistence V1

Conversation Persistence V1 donne aux sessions Nova une continuité conversationnelle sûre sans stocker de contenu sensible brut.

## Objectifs

- Persister des turns conversationnels par session sous `.nova/sessions/conversations`.
- Garder seulement des previews bornées et redacted, plus des métadonnées de run.
- Produire une compaction déterministe sans LLM.
- Injecter un résumé de session dans le Context Builder au début d'un run.
- Enregistrer un turn sûr à la fin du run.
- Exposer une CLI minimale sans nécessiter de clé LLM.

## Stockage

```txt
.nova/sessions/
  conversations/
    <sessionId>.json
```

Chaque record contient :

- `turns[]` bornés ;
- `summary` déterministe ;
- ids de runs et approvals ;
- décisions, blockers, next steps extraits de façon heuristique ;
- flags de sécurité indiquant metadata-only, sans raw prompts, sans raw tool inputs et sans secrets.

## CLI

```bash
nova conversations show <sessionId>
nova conversations summary <sessionId>
nova conversations compact <sessionId>
```

Ces commandes lisent/écrivent uniquement les métadonnées locales. Elles ne déclenchent ni LLM, ni tools, ni action destructive.

## Intégration agent

Au début d'un run avec session active :

1. `NovaAgent` crée/récupère la session.
2. Le `defaultSessionId` effectif est passé au Context Builder.
3. Le Context Builder ajoute le bloc `session_conversation_summary` si un résumé existe.

À la fin d'un run :

1. Le run est finalisé.
2. Un turn conversationnel sûr est ajouté avec :
   - preview utilisateur redacted/bornée ;
   - résumé assistant borné ;
   - runId/status ;
   - tool call count ;
   - approval ids par statut ;
   - budget exceeded ;
   - décisions/blockers/next steps metadata.

## Compaction déterministe

La compaction V1 n'appelle pas de LLM. Elle :

- conserve les derniers turns configurés ;
- agrège les décisions ;
- agrège les blockers ;
- agrège les next steps ;
- conserve les ids de runs/approvals ;
- génère un bloc XML-like explicitement marqué comme metadata-only.

## Sécurité V1

- Pas de résumé LLM.
- Pas de stockage de prompts complets.
- Pas de raw tool inputs.
- Pas de secrets ou credentials bruts.
- Pas de raw traces/evals/rapports `.nova`.
- Pas de clear/destruction conversationnelle en V1.
- Pas de backend externe/vectoriel.

## Configuration

Variables optionnelles :

```bash
NOVA_CONVERSATION_ENABLED=1
NOVA_CONVERSATION_MAX_TURNS=100
NOVA_CONVERSATION_KEEP_RECENT_TURNS=20
NOVA_CONVERSATION_MAX_PREVIEW_CHARS=1000
NOVA_CONVERSATION_SUMMARY_MAX_CHARS=2000
NOVA_CONTEXT_CONVERSATION_SUMMARY=1
```

## Validation

```bash
npm run conversation:smoke
npm run eval:conversation
```
