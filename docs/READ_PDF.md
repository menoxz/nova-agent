# read_pdf

## Objectif

`read_pdf` est l'outil spécialisé PDF de Nova. Il complète `read_file` : au lieu d'attacher un PDF brut au modèle, il extrait les informations structurées exploitables.

## Capacités

- Métadonnées document (`mode: "metadata"`)
- Texte par page (`mode: "text"`)
- Page ranges : `"1"`, `"1,3"`, `"2-5"`, `"1,4-6"`
- Outline / bookmarks (`mode: "outline"`)
- Annotations / liens / champs (`mode: "annotations"`)
- Recherche texte (`mode: "search"`, avec `query`)
- Vue complète (`mode: "all"`)

## Paramètres

```ts
{
  path: string,
  mode?: "metadata" | "text" | "outline" | "annotations" | "search" | "all",
  pages?: string,
  query?: string,
  caseSensitive?: boolean,
  maxPages?: number,
  maxCharsPerPage?: number,
  includeAnnotations?: boolean
}
```

## Choix technique

Librairie : `pdfjs-dist`.

Raisons :

- TypeScript/Node natif
- extraction texte page par page
- metadata
- outline
- annotations
- pas besoin de Python ou outil externe

## Limites

- Pas d'OCR : les PDFs scannés/image-only retourneront peu ou pas de texte.
- Les tableaux ne sont pas reconstruits parfaitement : un futur outil table/PDF peut améliorer cela.
- Les PDFs chiffrés/protégés par mot de passe échouent avec message explicite.
- Taille max : 100 MB.
- Extraction limitée par défaut à 25 pages pour éviter les sorties géantes.

## Tests effectués

PDF local créé avec ReportLab : `tmp/nova-test.pdf`.

Contenu du PDF :

- 2 pages
- titre / auteur / sujet metadata
- outline : 2 entrées
- annotation lien vers `https://example.com`
- texte searchable contenant `Nova`

Tests :

```bash
npx tsc --noEmit
```

Résultat : 0 erreur.

```ts
read_pdf({ path: "tmp/nova-test.pdf", mode: "search", pages: "1-2", query: "Nova" })
```

Résultat : 2 matches, pages 1 et 2.

```ts
read_pdf({ path: "tmp/nova-test.pdf", mode: "all", pages: "1-2" })
```

Résultat validé : metadata, outline, annotation et texte extraits.

## Prochain outil

Prochain outil dans l'ordre demandé : Word (`.docx`) spécialisé.
