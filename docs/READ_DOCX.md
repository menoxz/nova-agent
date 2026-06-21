# read_docx

## Objectif

`read_docx` est l'outil spécialisé Word/DOCX de Nova. Il lit directement l'OOXML interne d'un `.docx` sans dépendre de Word ou LibreOffice.

## Capacités

- Metadata : `docProps/core.xml`, `docProps/app.xml`
- Texte structuré : paragraphes + headings détectés par style `Heading1..Heading9` / `Titre1..Titre9`
- Tables : extraction lignes/cellules
- Headers / footers
- Comments : `word/comments.xml` si présent
- Images/media détectés : `word/media/*`, type MIME et taille
- Recherche texte dans body, tables, headers, footers, comments

## Paramètres

```ts
{
  path: string,
  mode?: "metadata" | "text" | "tables" | "headers" | "comments" | "media" | "search" | "all",
  query?: string,
  caseSensitive?: boolean,
  maxBlocks?: number,
  maxChars?: number,
  maxTables?: number,
  maxRows?: number,
  maxCells?: number
}
```

## Choix technique

Librairies :

- `jszip` : ouvrir le `.docx` comme ZIP
- extraction XML ciblée : `word/document.xml`, `docProps/*.xml`, `word/header*.xml`, `word/footer*.xml`, `word/comments.xml`, `word/media/*`

Raison : robustesse, pas de dépendance Office, pas de conversion.

## Limites

- `.doc` legacy non supporté : convertir en `.docx` d'abord.
- Tracked changes : texte supprimé peut être visible car `w:delText` est inclus best-effort.
- Text boxes, footnotes/endnotes, shapes complexes : amélioration future possible.
- La structure visuelle exacte Word n'est pas reproduite.
- OCR non applicable : images dans DOCX sont détectées mais non analysées visuellement ici.

## Tests effectués

DOCX local créé avec `python-docx` : `tmp/nova-test.docx`.

Contenu :

- metadata : title, author, subject, keywords
- heading 1 + heading 2
- paragraphes avec mot-clé `Nova`
- table 3x2
- header `Nova Header`
- footer `Nova Footer`
- image PNG intégrée

Tests :

```bash
npx tsc --noEmit
```

Résultat : 0 erreur.

```ts
read_docx({ path: "tmp/nova-test.docx", mode: "metadata" })
```

Résultat : metadata propres, sans capture XML parasite.

```ts
read_docx({ path: "tmp/nova-test.docx", mode: "search", query: "Nova" })
```

Résultat : matches dans body, tables, header, footer.

```ts
read_docx({ path: "tmp/nova-test.docx", mode: "all" })
```

Résultat validé : metadata, text, table, header/footer, comments none, media image détectée.

## Prochain outil

Prochain outil dans l'ordre demandé : Excel (`.xlsx`) spécialisé.
