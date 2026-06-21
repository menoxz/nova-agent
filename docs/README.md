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
| [mcp/README.md](mcp/README.md) | Serveur MCP stdio V1, outils read-only, sécurité et setup client |
| [READ_FILE_MULTIMODAL.md](READ_FILE_MULTIMODAL.md) | Design et limites de `read_file` multimodal |
| [READ_PDF.md](READ_PDF.md) | Design, paramètres, tests et limites de `read_pdf` |
| [READ_DOCX.md](READ_DOCX.md) | Design, paramètres, tests et limites de `read_docx` |
| [TRACE_EVAL.md](TRACE_EVAL.md) | Tracing structuré ReAct/tools et harnais d'évaluation |
