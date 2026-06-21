# ⭐ Nova Agent

> Agent autonome généraliste — boucle ReAct + outils + mémoire + soul

Nova est un agent LLM autonome construit en TypeScript avec le Vercel AI SDK v6. Il incarne les 4 piliers d'un agent : **boucle ReAct, outils, identité (soul), mémoire**.

## Quick Start

```bash
cd C:\jeanluc\nova-agent

# Lancer en mode interactif
npm run dev

# Lancer avec un prompt unique
npx tsx src/index.ts "Read soul.md and summarize Nova's principles"
```

## Stack

| Couche | Technologie |
|--------|-------------|
| Runtime | Node.js 22 + TypeScript 5 |
| LLM SDK | Vercel AI SDK v6 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) |
| Schemas | Zod |
| CLI | `@clack/prompts` + `chalk` |

## Provider Actuel

- **API**: OpenModel (Anthropic-compatible) → `https://api.openmodel.ai/v1`
- **Modèle**: `deepseek-v4-flash`
- **Provider suivant**: OpenAI, OpenRouter, DeepSeek direct, Ollama

## Structure du Projet

```
nova-agent/
├── docs/                  ← Vous êtes ici
├── soul.md                ← Identité, valeurs, règles de l'agent
├── src/
│   ├── index.ts           ← Point d'entrée CLI
│   ├── agent.ts           ← Boucle ReAct
│   ├── types.ts           ← Types partagés
│   ├── llm/
│   │   └── provider.ts    ← Abstraction multi-provider
│   ├── memory/
│   │   └── conversation.ts ← Mémoire de conversation
│   └── tools/
│       ├── registry.ts    ← Registre central des outils
│       ├── types.ts       ← Ré-export des types outils
│       └── builtin/       ← Outils intégrés
│           ├── read_file.ts
│           ├── write_file.ts
│           └── bash.ts
├── .env                   ← Configuration LLM (gitignoré)
├── package.json
└── tsconfig.json
```

## Navigation dans la Doc

| Document | Contenu |
|----------|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture détaillée, 4 piliers, data flow |
| [FILES.md](FILES.md) | Documentation fichier par fichier |
| [DECISIONS.md](DECISIONS.md) | Décisions clés et leur justification |
| [ROADMAP.md](ROADMAP.md) | Prochaines itérations et améliorations |
| [RUNBOOK.md](RUNBOOK.md) | Commandes, débogage, extension |
| [policy/README.md](policy/README.md) | Policy/Permissions V1: profils, règles, audit, smoke/eval sécurité |
| [mcp/README.md](mcp/README.md) | Serveur MCP stdio V1, outils read-only, sécurité et setup client |
| [lsp/README.md](lsp/README.md) | Serveur LSP stdio V1 read-only, capacités, sécurité, diagnostics et smoke test |
| [subagents/README.md](subagents/README.md) | Sub-agent Orchestration V1: rôles bornés, délégation, contexte, DAG, sécurité |
| [profiles/README.md](profiles/README.md) | Agent Profiles V1: agents spécialisés persistants, résolution runtime, sécurité, built-ins |
| [memory/README.md](memory/README.md) | Memory/Knowledge V1 plan: scopes, persistence, retrieval, lifecycle, security, evals |
| [context-builder.md](context-builder.md) | Context Builder V1: mémoire user/org éditable, politique d'injection, budget token, skills/MCP |
| [token-management.md](token-management.md) | Token Management V1: estimation, vitesse tokens/seconde, compaction, auto-suggestion skills/MCP |
| [session-run-manager.md](session-run-manager.md) | Session + Run Manager V1: sessions, runs, planner minimal, budgets, approvals, observabilité |
| [approval-manager.md](approval-manager.md) | Approval Manager V1: policy ask bridge, approvals persistées, CLI sûre list/approve/deny |
| [run-replay-resume.md](run-replay-resume.md) | Run Replay/Resume V1: replay metadata-only, reprise par run enfant, aucune auto-exécution risquée |
| [conversation-persistence.md](conversation-persistence.md) | Conversation Persistence V1: turns redacted par session, compaction déterministe, injection contextuelle sûre |
| [current-session-ux.md](current-session-ux.md) | Current Session UX V1: pointeur courant metadata-only, commandes sans copier-coller d'IDs |
| [config-file.md](config-file.md) | Config File V1: `.nova/config.json`, defaults projet sûrs, validation stricte, CLI config |
| [streaming-ux.md](streaming-ux.md) | Streaming UX V1: tokens live, timer, coût, outils, thinking/reasoning pliable, fallback non-streaming |
| [streaming-event-log.md](streaming-event-log.md) | Streaming Event Log / Replay V1: JSONL redacted, replay CLI sans LLM/tools |
| [READ_FILE_MULTIMODAL.md](READ_FILE_MULTIMODAL.md) | Design et limites de `read_file` multimodal |
| [READ_PDF.md](READ_PDF.md) | Design, paramètres, tests et limites de `read_pdf` |
| [READ_DOCX.md](READ_DOCX.md) | Design, paramètres, tests et limites de `read_docx` |
| [TRACE_EVAL.md](TRACE_EVAL.md) | Tracing structuré ReAct/tools et harnais d'évaluation |
