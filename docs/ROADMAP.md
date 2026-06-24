# Roadmap Nova Agent

> Ce document liste les prochaines améliorations logiques, par ordre de priorité.

## ✅ Itération 1 — MVP (Terminé)

- [x] ReAct loop avec generateText()
- [x] 3 outils builtin (read_file, write_file, bash)
- [x] Multi-provider LLM (OpenModel/Anthropic + OpenAI)
- [x] Mémoire de conversation en RAM
- [x] CLI interactif + one-shot
- [x] Soul.md / identité
- [x] Documentation (docs/)

## ✅ Itération 2 — Amélioration des outils (Terminé)

- [x] **Corriger le doublon d'affichage reasoning/answer**
  - Solution: `step.text` n'est push comme 'reasoning' QUE si `step.toolCalls` est non vide
- [x] **Améliorer read_file** — stats fichier, offset/limit, limites taille, messages d'erreur clairs
- [x] **Améliorer write_file** — mode append, backup .bak, stats bytes écrits
- [x] **Améliorer bash** — output truncation, description context, timeout configurable, maxBuffer
- [x] **Ajouter glob** — recherche fichiers par pattern (*, **, ?), marche récursive, limite 200 résultats
- [x] **Ajouter grep** — recherche contenu par regex, case-insensitive, filtre par extension
- [x] **Ajouter list_directory** — listing type/size/date avec tris, format lisible
- [x] **Ajouter get_file_info** — metadata complet (taille, dates, type, extension, mode)

## ✅ Itération 3 — Audit et amélioration par cas d'usage (Terminé)

- [x] **read_file** — détection binaire/texte, head/tail/hex modes, info fichier binaire, hash si binaire
- [x] **write_file** — dry-run preview + diff, atomic write, backup amélioré
- [x] **bash** — env vars, stdin pipe, description context, meilleure gestion timeout/signal
- [x] **glob** — exclude patterns, depth limit, meilleur filtrage
- [x] **grep** — binary auto-skip, context lines (before/after), count mode, inverse match
- [x] **list_directory** — mode récursif (arborescence), summary mode, total size
- [x] **get_file_info** — SHA256 hash, MIME type detection, support multi-chemins

## 🎯 Itération 4 — Prochaine

- [x] **search_web** — recherche web via API (`src/tools/builtin/web_search.ts`)
- [x] **git_status / git_diff** — intégration Git (`src/tools/builtin/git.ts`)
- [x] **Context Builder V1** — composition du contexte agent avec mémoire user/org éditable, mémoire projet, capacités tools/skills/MCP, budget token et justifications (`docs/context-builder.md`, `src/context`)
- [x] **Session + Run Manager V1 foundations** — sessions/runs persistés localement, planner minimal, budgets/coûts, approvals et rapports metadata-only (`docs/session-run-manager.md`, `src/session`)
- [x] **Approval Manager V1 foundations** — policy ask -> approval request, approvals list/approve/deny, CLI runtime minimale sans auto-exécution risquée (`docs/approval-manager.md`, `src/approval`)
- [x] **Run Replay/Resume V1** — replay/report metadata-only, reprise contrôlée par run enfant planifié, aucune ré-exécution automatique d'action approuvée (`docs/run-replay-resume.md`, `src/session/replay.ts`, `src/session/resume.ts`)
- [x] **Conversation Persistence V1** — turns conversationnels redacted par session, compaction déterministe sans LLM, injection contextuelle sûre, CLI show/summary/compact (`docs/conversation-persistence.md`, `src/session/conversation.ts`)
- [x] **Current Session UX V1** — pointeur courant metadata-only, commandes sessions/runs/conversations sans copier-coller d'IDs, mise à jour agent/resume/use (`docs/current-session-ux.md`, `src/session/current.ts`)
- [x] **Config File V1** — `.nova/config.json` pour defaults projet/runtime sûrs, validation stricte, merge env/CLI, CLI show/init/validate/explain (`docs/config-file.md`, `src/config`)
- [x] **Streaming UX V1** — expérience CLI live avec tokens, timer, coût estimé, events outils redacted, thinking/reasoning pliable et fallback `generateText()` (`docs/streaming-ux.md`, `src/streaming`)
- [x] **LLM Robustness V1** — timeout, retries/backoff, classification erreurs provider et diagnostics CLI/streaming (`docs/llm-robustness.md`, `src/llm`)
- [x] **CLI Help / Command UX V1** — aide globale/par domaine sans clé LLM, flags principaux documentés, erreurs de commande pédagogiques (`docs/cli-usage.md`, `src/cli`)
- [x] **Batch Mode V1.2** — `nova batch <file>` séquentiel, entrées `.txt`/`.json`, rapport JSON, rapport Markdown `--report-md`, sortie automation `--ci`, options streaming/event-log/report/continue-on-error (`docs/batch-mode.md`, `src/batch`)
- [x] **TUI Prototype V0.1** — replay/latest terminal des `RuntimeStreamingEvent`/event logs existants: modes compact/verbose, timeline, metrics, tools, reasoning, final/erreur (`docs/tui-prototype.md`, `src/tui`)
- [x] **Packaging / Install UX V1** — wrapper `bin/nova.js`, `bin.nova` fiable, build/local link, docs dev vs installed et smoke binaire (`docs/packaging-install.md`)
- [x] **Release Notes / Versioning V1** — `nova --version`/`nova version`, version package en aide CLI, changelog initial et smokes binaires/version (`CHANGELOG.md`, `src/cli/version.ts`)
- [x] **Quality Gate V1** — scripts `npm run check:fast` et `npm run check`, smokes clés, eval release/quality et runbook de validation locale sans clé LLM réelle
- [x] **Provider Profiles / Fallback contrôlé V1** — profils provider/model explicites, `nova providers list/show/doctor`, diagnostic sans secrets et fallback opt-in non silencieux (`docs/provider-profiles.md`, `src/providers`)
- [x] **Heartbeat / Autonomous Tasks V1 safe slice** — CLI/config/store/report/tick `--dry-run`, désactivé par défaut, rapports metadata-only sous `.nova/heartbeat`, lock anti-overlap, aucune exécution autonome/daemon/LLM/tools (`docs/heartbeat.md`, `src/heartbeat`)
- [ ] **Mémoire persistante**
  - [x] Plan Memory/Knowledge V1 complet documenté (`docs/memory/`)
  - [x] Persistance locale sécurisée sous `.nova/memory` avec index rebuildable
  - [x] Scopes project/workspace/profile/session/user/subagent/capability sans mémoire globale incontrôlée
  - [x] Retrieval policy-gated avec wrapper de contexte non fiable et budgets tokens
  - [x] Write pipeline: propose, validate, secret scan, raw artifact reject, redact, dedupe/hash, approval, persist, audit
  - [x] Smoke/eval Memory V1
  - [ ] Option future: base vectorielle/RAG après baseline JSON déterministe
- [x] **Mode streaming** — `streamText()` pour affichage progressif sûr en temps réel

- [x] **Mode streaming**
  - `streamText()` au lieu de `generateText()` pour voir le raisonnement en temps réel
  - Utiliser le streaming pour l'affichage progressif

## 🔭 Itération 3 — Améliorations

- [x] **Heartbeat / Tâches autonomes — tranche V1 sûre**
  - [x] CLI/config/store/report/tick dry-run, disabled-by-default
  - [x] Aucun daemon, aucun LLM live, aucune action write/shell/git/network/memory autonome
  - [ ] Future: exécution réelle uniquement après design d'approvals explicites et sandbox

- [ ] **Gestion d'erreurs robuste**
  - [x] Retry sur les appels LLM non-streaming
  - [x] Classification rate limit/provider/network/auth/timeout
  - [x] Timeout configurables

- [x] **Mode batch / script**
  - Lire une liste de prompts depuis un fichier
  - Mode non-interactif pour pipeline CI/CD

- [ ] **Configuration avancée**
  - Fichier de config YAML/JSON
  - [x] Agent Profiles V1 foundation (`src/profiles`, built-ins, runtime resolution, smoke/eval)
  - [ ] Future product/env profiles (dev, prod, test) layered on top of Agent Profiles

## 🚀 Itération 4 — Production

- [ ] **Multi-agent**
  - Orchestrateur qui délègue à des agents spécialisés
  - Communication inter-agents

- [ ] **MCP (Model Context Protocol)**
  - [x] Serveur MCP stdio V1 read-only (`src/mcp/server.ts`)
  - [x] Outils/resources/prompts `nova_*` sécurisés
  - [x] Backlog MCP V1.1 documenté (`docs/mcp/BACKLOG_V1_1.md`)
  - [ ] Transport HTTP/streamable optionnel, sécurisé, désactivé par défaut et localhost-only par défaut
  - [ ] Tests automatisés MCP Inspector
  - [ ] Evals MCP renforcées: denylist, traversal, outside-root, secrets synthétiques, caps, absence d'outils, resources/prompts
  - [ ] Ressources enrichies mais curatées: statut, schémas, résumés sanitizés, metadata outils, index docs
  - [ ] Packaging/distribution: entrypoint MCP, exemples clients, versioning, checklist release
  - [ ] Futures capacités state/write/shell uniquement avec gating explicite

- [ ] **Tests**
  - Tests unitaires pour chaque outil
  - Tests d'intégration pour la boucle ReAct
  - [x] CI/CD avec GitHub Actions — `.github/workflows/ci.yml` + `.github/workflows/release.yml`

- [x] **LSP (Language Server Protocol) V1**
  - [x] Serveur LSP stdio read-only (`src/lsp/server.ts`)
  - [x] Hover, completion, diagnostics, document symbols, workspace symbols
  - [x] Commandes LSP read-only uniquement; pas de `WorkspaceEdit`, shell ou write
  - [x] Metadata Nova sûre: scripts, outils/resources/prompts connus, docs, eval suites/scenarios, policy
  - [x] Smoke protocol (`npm run lsp:smoke`) et eval mock (`npm run eval:lsp`)
  - [ ] V1.1: extraction metadata plus riche, setup clients, tests unitaires policy/metadata

- [ ] **Sécurité**
  - [x] Policy/Permissions V1 shared core: profils, règles déterministes, path/redaction/output helpers, audit metadata-only, ToolRegistry hook optionnel
  - [x] Sandbox d'exécution hardened (sous-processus isolé, capability-only, opt-in `NOVA_ENABLE_EXEC_SANDBOX`; ADR-002 Slice 3, `src/sandbox/**`) — câblage exécution déléguée différé (Slice 4)
  - Validation des chemins de fichiers
  - Approbation utilisateur pour les actions destructrices
