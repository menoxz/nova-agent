# Architecture de Nova Agent

## Les 4 Piliers

```
         ┌─────────────────────────────────────┐
         │            SOUL.md                   │
         │   (identité, valeurs, règles)        │
         └──────────────┬──────────────────────┘
                        │ inspire
         ┌──────────────▼──────────────────────┐
         │         HEART BEAT (Boucle)          │
         │                                      │
         │  ┌──────┐   ┌───────┐   ┌────────┐  │
         │  │Reason│──▶│ Act   │──▶│Observe │  │
         │  └──────┘   └───────┘   └────────┘  │
         │      ▲            │            │     │
         │      └────────────┴────────────┘     │
         └──────────────┬──────────────────────┘
                        │ utilise
         ┌──────────────▼──────────────────────┐
         │     TOOLS + MEMORY                   │
         │  (pouvoir d'agir + se souvenir)      │
         └─────────────────────────────────────┘
```

## 1. Boucle ReAct (Reason + Act)

**Fichier**: `src/agent.ts`

Nova utilise `generateText()` du Vercel AI SDK avec:
- Un **system prompt** construit à partir de `soul.md` + la liste des outils
- Les **messages** de la conversation en cours
- Les **outils** convertis au format SDK via `ToolSet`
- `stopWhen: stepCountIs(15)` → max 15 étapes de raisonnement

Le callback `onStepFinish` capture chaque étape pour l'affichage et met à jour la mémoire avec les résultats d'outils.

**Flux**:
1. `agent.run(input)` reçoit la question utilisateur
2. `userMessage(input)` est ajoutée à la mémoire
3. `generateText()` démarre avec system prompt, messages, outils
4. Le LLM raisonne → appelle un outil → résultat retourné → re-raisonne → ...
5. Quand le LLM produit une réponse textuelle, le cycle s'arrête
6. La réponse est ajoutée à la mémoire
7. Les `StepDisplay[]` sont retournés pour affichage

## 2. Outils (Tools)

**Fichiers**: `src/tools/`

Chaque outil est défini comme un `NovaTool`:
```typescript
interface NovaTool {
  name: string;           // Nom unique de l'outil
  description: string;    // Description pour le LLM
  inputSchema: FlexibleSchema<any>;  // Schéma Zod des paramètres
  execute: (input: any) => Promise<string>;  // Fonction d'exécution
}
```

Le `ToolRegistry` centralise les outils et les convertit au format Vercel AI SDK (`ToolSet`) via `toAITools()`.

## 3. Identité (Soul)

**Fichier**: `soul.md`

Le fichier `soul.md` est lu au démarrage et injecté comme **system prompt** du LLM. Il définit:
- L'identité de Nova
- Les principes fondamentaux (ex: "Vérifier avant d'agir")
- Les règles de conduite
- La métaphore (forgeron cosmique)

## 4. Mémoire

**Fichier**: `src/memory/conversation.ts`

Actuellement, la mémoire est :
- **Court-terme** : buffer de messages (`ModelMessage[]`) en mémoire vive
- Les messages utilisateur, assistant et résultats d'outils sont stockés
- Taille max configurable (50 messages par défaut)
- Les anciens messages sont automatiquement purgés

### Format des messages

Utilise le format `ModelMessage` du SDK (`@ai-sdk/provider-utils`):
- `UserModelMessage` : `{ role: 'user', content: [{ type: 'text', text }] }`
- `AssistantModelMessage` : `{ role: 'assistant', content: [{ type: 'text', text }] }`
- `ToolModelMessage` : `{ role: 'tool', content: [{ type: 'tool-result', ... }] }`

## Multi-Provider LLM

**Fichier**: `src/llm/provider.ts`

`createModel(config)` choisit le provider selon `config.provider`:

| Provider | SDK | Endpoint |
|----------|-----|----------|
| `openmodel` / `anthropic` | `@ai-sdk/anthropic` | `/v1/messages` |
| `openai` / `openrouter` / `deepseek` | `@ai-sdk/openai` | `/v1/chat/completions` |

## CLI

**Fichier**: `src/index.ts`

Deux modes :
- **Interactif** : invite permanente avec `@clack/prompts`
- **One-shot** : `npx tsx src/index.ts "prompt"`

Commandes spéciales en interactif :
- `exit` / `quit` → quitter
- `reset` → effacer la mémoire
