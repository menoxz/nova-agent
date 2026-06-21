# Documentation Fichier par Fichier

## Racine

### `soul.md`
**Rôle**: Identité, principes et règles de conduite de Nova.
**Ce que j'y trouverai**: La personnalité de l'agent. Modifier ce fichier change le comportement de Nova (system prompt).
**Quand le modifier**: Pour changer la personnalité, les règles, ou la métaphore.

### `package.json`
**Rôle**: Dépendances et scripts.
**Scripts importants**:
- `npm run dev` → `tsx src/index.ts` (lancement)
- `npm run typecheck` → `tsc --noEmit` (vérification)
**Dépendances clés**: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `zod`, `chalk`, `@clack/prompts`

### `tsconfig.json`
**Rôle**: Configuration TypeScript. Target ES2022, module ESNext, strict mode.

### `.env`
**Rôle**: Configuration LLM (API key, base URL, model). **Gitignoré.**
**Variables**:
- `LLM_PROVIDER` = `openmodel` | `openai` | `anthropic`
- `LLM_BASE_URL` = URL de l'API
- `LLM_API_KEY` = clé API
- `LLM_MODEL` = nom du modèle

---

## `src/`

### `src/index.ts`
**Rôle**: Point d'entrée. Charge la config, initialise l'agent, lance le CLI.
**Fonctions**:
- `loadConfig()` : lit `.env` + `soul.md`
- `setupTools()` : enregistre les 3 outils builtin
- `showWelcome()` : affiche le banner
- `printSteps()` : affiche les étapes ReAct avec couleurs
- `main()` : boucle interactive ou one-shot
**Commandes spéciales**: `exit`, `quit`, `reset`

### `src/agent.ts`
**Rôle**: Cœur de l'agent — la boucle ReAct.
**Classe**: `NovaAgent`
- `config` : `AgentConfig` (LLM, system prompt, max steps)
- `tools` : `ToolRegistry` (outils enregistrés)
- `memory` : `ConversationMemory` (messages)
- `run(input)` : exécute une interaction complète
- `buildSystemPrompt()` : construit le prompt système à partir de soul.md + outils
**Ce que j'y trouverai**: La logique de raisonnement, l'appel `generateText()`, le callback `onStepFinish`.

### `src/types.ts`
**Rôle**: Types partagés dans tout le projet.
**Types**:
- `LLMConfig` : configuration du provider LLM
- `NovaTool` : définition d'un outil
- `AgentConfig` : configuration de l'agent
- `StepDisplay` : structure pour l'affichage des étapes

---

## `src/llm/`

### `src/llm/provider.ts`
**Rôle**: Abstraction multi-provider. Crée le modèle LLM selon la config.
**Fonction**: `createModel(config: LLMConfig): LanguageModel`
**Logique**:
- `openmodel` / `anthropic` → `createAnthropic({ baseURL, apiKey }).chat(model)`
- `openai` / `openrouter` / `deepseek` → `createOpenAI({ baseURL, apiKey }).chat(model)`
- défaut → `createAnthropic`
**Quand le modifier**: Pour ajouter un nouveau provider (Ollama, Google, etc.)

---

## `src/memory/`

### `src/memory/conversation.ts`
**Rôle**: Gestion de la mémoire conversationnelle.
**Classes/Fonctions**:
- `ConversationMemory` : stocke les `ModelMessage[]`
  - `add(msg)` : ajoute un message, purge si trop long
  - `getMessages()` : retourne la liste complète
  - `clear()` : vide la mémoire
- `userMessage(text)` : crée un message utilisateur formaté
- `assistantMessage(text)` : crée un message assistant formaté
- `toolResultMessage(toolCallId, toolName, result)` : crée un résultat d'outil formaté
**Limitation actuelle**: mémoire en RAM seulement, perdue au redémarrage.
**Quand le modifier**: Pour ajouter de la persistance (fichier, base vectorielle).

---

## `src/tools/`

### `src/tools/types.ts`
**Rôle**: Ré-export des types NovaTool pour clarté.

### `src/tools/registry.ts`
**Rôle**: Registre central des outils.
**Classe**: `ToolRegistry`
- `register(tool)` : enregistre un outil (vérifie les doublons)
- `get(name)` : récupère un outil par nom
- `list()` : liste tous les outils
- `toAITools()` : convertit au format `ToolSet` du Vercel AI SDK
- `getSystemPromptBlock()` : génère la section outils du system prompt

### `src/tools/builtin/read_file.ts`
**Outil**: `read_file`
**Paramètres**: `path` (string), `limit` (number, optionnel)
**Action**: Lit un fichier sur le système de fichiers.
**Retour**: Contenu du fichier ou message d'erreur.

### `src/tools/builtin/write_file.ts`
**Outil**: `write_file`
**Paramètres**: `path` (string), `content` (string)
**Action**: Écrit du contenu dans un fichier (crée/écrase).
**⚠️**: Dangereux — peut écraser des fichiers existants.

### `src/tools/builtin/bash.ts`
**Outil**: `bash`
**Paramètres**: `command` (string), `timeout` (number, optionnel), `workdir` (string, optionnel)
**Action**: Exécute une commande shell (PowerShell 7 sur Windows).
**⚠️**: Dangereux — modifie l'état du système.
