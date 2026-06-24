# Packaging / Install UX V1

Packaging / Install UX V1 rend la commande `nova` utilisable en développement local et via un lien npm local, sans pointer le champ `bin` directement vers `src/index.ts`.

Pour les dry-runs release-candidate sans publication ni mutation globale, utiliser aussi `docs/release-candidate-dry-run-checklist.md`.

## Modes d'usage

### Développement dans le dépôt

Utiliser `tsx` explicitement :

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts --stream "résume le projet"
```

Les scripts historiques restent valides :

```bash
npm run dev
npm run start -- --help
```

### Binaire local du dépôt

Le wrapper binaire est `bin/nova.js` :

```bash
node bin/nova.js --help
node bin/nova.js --version
node bin/nova.js tui --help
```

Comportement :

1. si `dist/index.js` existe, le wrapper charge le build JavaScript ;
2. sinon, il utilise le fallback dev `node --import tsx src/index.ts ...`.

Ce fallback évite le shebang fragile `#!/usr/bin/env tsx` sur `src/index.ts` tout en conservant l'usage dev.

### Binaire MCP stdio dédié

Le wrapper MCP est `bin/nova-mcp.js` et le package expose aussi le bin `nova-mcp` :

```bash
node bin/nova-mcp.js --help
node bin/nova-mcp.js --version
node bin/nova-mcp.js
```

Comportement :

1. si `dist/mcp/server.js` existe, le wrapper démarre ce serveur buildé en stdio ;
2. sinon, il utilise le fallback dev `node --import tsx src/mcp/server.ts` ;
3. seuls `--help` et `--version` sont acceptés comme arguments metadata-only.

`nova-mcp` ne lance pas la CLI interactive, n'active aucun transport HTTP/streamable, et n'enregistre pas `nova_bash`, `nova_write_file` ni les state tools par défaut.

### Installation locale réaliste

Ces commandes simulent une installation locale, mais elles ne sont pas pure read-only : `npm link` modifie l'état npm global et doit être réservé aux validations explicitement autorisées avec nettoyage documenté.

Depuis le dépôt :

```bash
npm link
nova --help
nova-mcp --help
nova version
nova batch prompts.txt
nova tui replay <logId>
```

Depuis un autre dossier sans modifier le registre npm :

```bash
npm link C:\jeanluc\nova-agent
nova --help
nova --version
nova-mcp --version
```

En développement, le wrapper fonctionne même si `dist/` est absent grâce au fallback `tsx`. Pour vérifier le chemin installé/buildé, exécuter `npm run build` avant `npm link`.

## Scripts packaging

```bash
npm run build             # compile TypeScript vers dist/
npm run bin:smoke         # vérifie node bin/nova.js + npm link + aide/version sans clé LLM
npm run mcp:bin-smoke     # vérifie node bin/nova-mcp.js + handshake MCP stdio buildé + npm link
npm run release:readiness # vérifie le manifeste npm dry-run sans scripts
```

`node bin/nova.js --version` et `nova --version` utilisent la version de `package.json`. Ces chemins sont des commandes metadata-only : ils ne nécessitent pas `LLM_API_KEY` et ne déclenchent ni agent, ni LLM, ni tools.

`node bin/nova-mcp.js --version` et `nova-mcp --version` utilisent aussi la version de `package.json`. Le démarrage sans argument ouvre un serveur MCP stdio local uniquement.

Pour inspecter le manifeste sans exécuter `prepack`, sans reconstruire `dist/` et sans écrire de tarball :

```bash
npm pack --dry-run --ignore-scripts
```

Ne pas utiliser `npm pack` normal pour un dry-run pure read-only : `prepack` exécute `npm run build`, ce qui écrit les artefacts `dist/` avant la création du paquet.

## Champs package

- `main`: `dist/index.js`
- `bin.nova`: `./bin/nova.js`
- `bin.nova-mcp`: `./bin/nova-mcp.js`
- `files`: `bin/`, `dist/`, `scripts/assert-release-readiness.mjs`, selected docs (`docs/packaging-install.md`, `docs/RUNBOOK.md`, `docs/cli-usage.md`, `docs/mcp/*.md` including `BACKLOG_V1_1.md`, `docs/provider-live-smoke-readiness.md`, `docs/release-candidate-dry-run-checklist.md`, `docs/policy/README.md`), `CHANGELOG.md`, `soul.md`
- The package intentionally excludes build smoke outputs (`dist/**/*smoke*.js`, `dist/**/*smoke*.d.ts`) and non-essential source-repository docs.

`npm run release:readiness` requires the MCP stdio bin (`bin/nova-mcp.js`), MCP docs, packaging docs, and release checklist docs in the manifest, while rejecting `.env`, `.nova`, `node_modules`, `tmp`, `.vscode`, `src`, and non-doc smoke artifacts.

## Compatibilité MCP

- Runtime de référence : Node.js 22.x (baseline CI).
- SDK MCP : `@modelcontextprotocol/sdk ^1.29.0`.
- Transport package : stdio uniquement via `nova-mcp`; aucun transport HTTP/streamable n'est activé par défaut.

## Limites V1

- pas de publication npm réelle ;
- pas de pipeline CI/CD release ;
- pas de packaging natif executable ;
- pas de changement provider/model.
