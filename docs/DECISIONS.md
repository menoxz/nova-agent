# Décisions d'Architecture

## Décision 001 — TypeScript plutôt que Python

**Contexte**: Choix du langage pour l'agent.
**Option choisie**: TypeScript
**Alternatives**: Python (LangChain, plus d'exemples)
**Raison**:
- L'environnement opencode est déjà TS → compatible
- Vercel AI SDK offre une abstraction multi-provider mature
- Typage strict réduit les erreurs runtime dans un agent autonome
- Zod pour la validation des schémas d'outils
- `tsx` permet d'exécuter du TS sans build

---

## Décision 002 — Vercel AI SDK plutôt que wrapper maison

**Contexte**: Comment interagir avec le LLM et gérer les tool calls.
**Option choisie**: `generateText()` avec `tools` + `onStepFinish`
**Alternatives**: Appels REST bruts, LangChain, implémentation ReAct manuelle
**Raison**:
- Le SDK gère automatiquement la boucle tool call (pas besoin de gérer les IDs, l'historique, le parsing)
- Le callback `onStepFinish` permet de capturer chaque étape proprement
- Multi-provider natif (OpenAI, Anthropic, etc.)
- `stopWhen: stepCountIs(N)` remplace proprement le maxSteps

---

## Décision 003 — Anthropic-compatible (OpenModel) plutôt qu'OpenAI

**Contexte**: Le provider OpenModel utilise un format API différent.
**Option choisie**: Provider Anthropic avec baseURL personnalisée
**Raison**:
- OpenModel expose `/v1/messages` (format Anthropic), pas `/v1/chat/completions`
- `@ai-sdk/anthropic` supporte `baseURL` et `apiKey` personnalisés
- `x-api-key` fonctionne comme header d'authentification
- Le SDK gère la conversion des messages automatiquement

---

## Décision 004 — Architecture incrémentale (MVP d'abord)

**Contexte**: Comment aborder le développement.
**Option choisie**: Petit → grand, itération par itération
**Raison**:
- Permet d'avoir un agent fonctionnel rapidement
- Chaque itération ajoute de la valeur visible
- "Quelle est la prochaine amélioration logique ?" guide le développement
- Évite la paralysie d'architecture

---

## Décision 005 — Memory in-memory (pas de persistance au MVP)

**Contexte**: Stockage de la mémoire.
**Option choisie**: Buffer en RAM uniquement
**Raison**:
- Simplicité maximale pour le MVP
- `ModelMessage[]` directement compatible avec `generateText`
- La persistance (fichier JSON, RAG, base vectorielle) sera ajoutée en itération 2
- Pas de dépendance supplémentaire pour démarrer

---

## Décision 006 — Système prompt via soul.md

**Contexte**: Comment fournir l'identité et les règles à l'agent.
**Option choisie**: Fichier `soul.md` lu au démarrage, injecté comme system prompt
**Raison**:
- Séparation claire entre le code et l'identité
- Modifiable sans recompilation
- Format markdown lisible et éditable
- Pourrait évoluer en système de templates avec variables
