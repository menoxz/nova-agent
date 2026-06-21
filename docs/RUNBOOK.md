# Runbook Nova Agent

## Commandes

```bash
# Lancer en mode interactif
npm run dev

# Lancer avec un prompt unique
npx tsx src/index.ts "Ta question ici"

# Vérifier le typage
npm run typecheck

# Lancer le serveur MCP stdio read-only
npm run mcp:stdio

# Smoke test MCP local
npm run mcp:smoke

# Lancer le serveur LSP stdio read-only
npm run lsp:stdio

# Smoke test LSP local
npm run lsp:smoke

# Eval LSP mock
npm run eval:lsp

# MCP Inspector
npx @modelcontextprotocol/inspector npm run mcp:stdio

# Future V1.1 target: replace manual Inspector checks with a documented automated Inspector test command.

# Installer une dépendance
npm install <package>
```

## Configuration (.env)

```env
LLM_PROVIDER=openmodel       # openmodel | openai | anthropic | openrouter
LLM_BASE_URL=https://api.openmodel.ai/v1
LLM_API_KEY=ta-clé-api
LLM_MODEL=deepseek-v4-flash
```

## Changer de Provider

### Pour utiliser OpenAI
```env
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=gpt-4o
```

### Pour utiliser OpenRouter
```env
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=openmodel/deepseek-v4-flash
```

### Pour utiliser DeepSeek direct
```env
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=deepseek-chat
```

## Ajouter un Outil

1. Créer `src/tools/builtin/ma_fonction.ts`:
```typescript
import { z } from 'zod';
import type { NovaTool } from '../../types.js';

export const myTool: NovaTool = {
  name: 'my_tool',
  description: 'Description claire pour le LLM.',
  inputSchema: z.object({
    param1: z.string().describe('Description du paramètre'),
  }),
  execute: async ({ param1 }) => {
    // Logique ici
    return 'Résultat';
  },
};
```

2. Enregistrer dans `src/index.ts`:
```typescript
import { myTool } from './tools/builtin/my_tool.js';
// ...dans setupTools():
registry.register(myTool);
```

## Liste Complète des Outils (v10)

| Outil | Description | Nouveautés Itération 3 | Dangereux |
|-------|-------------|----------------------|-----------|
| `read_file` | Lit fichier texte/binaire. Modes: full, head, tail, hex | 🔥 Détection binaire, head/tail/hex, type fichier, hash | ❌ |
| `write_file` | Écrit ou append. Dry-run, diff, atomic, backup | 🔥 Dry-run diff, atomic write, backup .bak | ✅ (écrase) |
| `bash` | Exécute commande shell. Env vars, stdin | 🔥 Env vars, stdin pipe, meilleur handling signaux | ✅ (modifie système) |
| `glob` | Cherche fichiers par pattern (\*, \*\*, ?) | 🔥 Exclude patterns, depth limit | ❌ |
| `grep` | Cherche texte par regex dans fichiers | 🔥 Binary skip, context lines, count, inverse match | ❌ |
| `list_directory` | Liste dossier (type/size/date). Récursif, summary | 🔥 Mode récursif arborescence, summary, total size | ❌ |
| `get_file_info` | Metadata fichier/dossier. Hash, MIME, multi | 🔥 SHA256 hash, MIME type, multi-path support | ❌ |

### Nouveaux paramètres par outil

**read_file**: `mode: "full"|"head"|"tail"|"hex"`, `lines: number`, `offset`, `limit`
**write_file**: `mode: "write"|"append"`, `backup`, `dryRun`, `atomic`
**bash**: `command`, `timeout`, `workdir`, `description`, `stdin`, `env: Record<string,string>`
**glob**: `pattern`, `root`, `maxResults`, `exclude: string[]`, `depth`
**grep**: `pattern`, `root`, `include`, `ignoreCase`, `maxResults`, `beforeContext`, `afterContext`, `invertMatch`, `count`
**list_directory**: `path`, `showHidden`, `sortBy`, `recursive`, `depth`, `summary`
**get_file_info**: `path`, `hash: boolean` (multi-chemins via virgule: "a.ts, b.ts")

## Débogage

### Problème: "route not found"
→ Vérifier que `LLM_BASE_URL` est correct et que le provider correspond au format d'API (Anthropic vs OpenAI).

### Problème: L'agent ne répond pas
→ Vérifier la connexion API: `curl.exe -X POST "$LLM_BASE_URL/messages" ...`
→ Vérifier la clé API dans `.env`
→ Vérifier les logs d'erreur dans la console

### Problème: Les outils ne sont pas appelés
→ Vérifier que le LLM supporte le tool calling (deepseek-v4-flash ✅)
→ Vérifier que le system prompt contient bien la description des outils
→ Vérifier que `maxSteps` n'est pas trop bas

### Problème: TypeError à l'import
→ Vérifier que les fichiers utilisent l'extension `.js` dans les imports (ESM)
→ Vérifier que `tsconfig.json` a `"module": "ESNext"`

## Structure pour un Nouvel Outil

```typescript
// Modèle à copier-coller
import { z } from 'zod';
import type { NovaTool } from '../../types.js';

export const monOutil: NovaTool = {
  name: 'mon_outil',
  description: 'Ce que fait cet outil.',
  inputSchema: z.object({
    // Paramètres avec descriptions pour le LLM
    chemin: z.string().describe('Chemin vers quelque chose'),
    option: z.boolean().optional().describe('Option activable'),
  }),
  execute: async ({ chemin, option }) => {
    try {
      // Implémentation
      return `Succès: ${chemin}`;
    } catch (err) {
      return `Erreur: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
```
