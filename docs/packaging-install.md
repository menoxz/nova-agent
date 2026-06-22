# Packaging / Install UX V1

Packaging / Install UX V1 rend la commande `nova` utilisable en développement local et via un lien npm local, sans pointer le champ `bin` directement vers `src/index.ts`.

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

### Installation locale réaliste

Depuis le dépôt :

```bash
npm link
nova --help
nova version
nova batch prompts.txt
nova tui replay <logId>
```

Depuis un autre dossier sans modifier le registre npm :

```bash
npm link C:\jeanluc\nova-agent
nova --help
nova --version
```

En développement, le wrapper fonctionne même si `dist/` est absent grâce au fallback `tsx`. Pour vérifier le chemin installé/buildé, exécuter `npm run build` avant `npm link`.

## Scripts packaging

```bash
npm run build       # compile TypeScript vers dist/
npm run bin:smoke   # vérifie node bin/nova.js + npm link + aide/version sans clé LLM
```

`node bin/nova.js --version` et `nova --version` utilisent la version de `package.json`. Ces chemins sont des commandes metadata-only : ils ne nécessitent pas `LLM_API_KEY` et ne déclenchent ni agent, ni LLM, ni tools.

## Champs package

- `main`: `dist/index.js`
- `bin.nova`: `./bin/nova.js`
- `files`: `bin/`, `dist/`, `docs/`, `CHANGELOG.md`, `soul.md`

## Limites V1

- pas de publication npm réelle ;
- pas de pipeline CI/CD release ;
- pas de packaging natif executable ;
- pas de changement provider/model.
