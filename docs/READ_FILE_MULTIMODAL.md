# read_file multimodal

## Objectif

`read_file` ne doit pas seulement lire du texte. Il doit exploiter les capacités multimodales du modèle lorsque le provider les supporte.

## Modes texte

- `mode: "full"` : lecture complète avec `offset`/`limit`.
- `mode: "head"` : premières lignes, contrôlé par `lines`.
- `mode: "tail"` : dernières lignes, contrôlé par `lines`.
- `mode: "hex"` : aperçu hexadécimal des 512 premiers bytes.

## Modes multimodaux

Paramètre :

```ts
multimodal: "auto" | "force" | "off"
```

| Mode | Comportement |
|------|--------------|
| `auto` | Attache automatiquement les petites images via `image-data`. Les autres fichiers restent metadata-only. |
| `force` | Tente d'attacher image/audio/vidéo/fichier via `image-data` ou `file-data`. Dépend du support provider/modèle. |
| `off` | Ne transmet jamais le fichier au modèle ; retourne seulement texte/metadata. |

## Sortie AI SDK

L'infrastructure Nova accepte maintenant `ToolResultOutput` :

- `type: "text"`
- `type: "json"`
- `type: "content"` avec :
  - `image-data`
  - `file-data`
  - `text`

`read_file` retourne :

- image petite → `content: [text, image-data]`
- audio/vidéo/générique en `force` → `content: [text, file-data]`
- binaire non attaché → metadata + suggestion
- texte → string standard

## Limites de sécurité

- Lecture texte max : 10 MB.
- Attachement multimodal défaut : 5 MB.
- Attachement multimodal hard max : 20 MB.
- La base64 n'est pas affichée dans la console : elle est résumée par `agent.ts`.

## Tests effectués

- `npx tsc --noEmit` → 0 erreur.
- Image PNG 1x1 créée dans `tmp/pixel.png`.
- Appel direct `read_file({ path: "tmp/pixel.png", multimodal: "force" })` → retourne `type: "content"` avec `text` + `image-data`, media `image/png`.
- Appel direct `read_file({ path: "soul.md", mode: "head", lines: 3 })` → retourne texte markdown correctement.

## Notes provider

L'envoi multimodal est techniquement prêt côté Nova/AI SDK. Le succès final dépend du modèle/provider :

- Les modèles vision devraient accepter `image-data`.
- Audio/vidéo/fichiers génériques via `file-data` peuvent être rejetés si le provider ne les supporte pas.
- En cas d'incertitude, utiliser `multimodal: "off"` pour metadata seulement, ou `force` pour tester explicitement.

## Prochain outil

Ne pas continuer vers bash/web/git/etc. tant que les outils documentaires n'ont pas été traités dans l'ordre décidé. Prochain outil prévu : PDF spécialisé, puis Word, puis Excel.
