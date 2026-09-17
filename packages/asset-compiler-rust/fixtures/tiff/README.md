# Fixture dorée — pilote TIFF

TIFF est un conteneur de champs plutôt qu'un format : le pilote déclare ses profils un par un et
refuse le reste en le nommant. La fixture suit cette coupe — sept fichiers que le pilote lit sans
perte, sept qu'il doit refuser. La dorée `src/plugins/tests/tiff.rs` décode les premiers et compare
les pixels RGBA8 **un par un** à une référence écrite en clair dans le test : une image de 4 × 2
pixels dont on connaît les huit valeurs.

## Ce que le pilote lit

| fichier                  | profil        | compression | ce qu'il met sous surveillance                       |
| ------------------------ | ------------- | ----------- | ---------------------------------------------------- |
| `rgb8-brut-ii.tiff`      | RGB 8 bits    | aucune (1)  | IFD en petit-boutien, tableau `BitsPerSample` hors champ, alpha rempli à 255 |
| `rgb8-brut-mm.tiff`      | RGB 8 bits    | aucune (1)  | le même fichier en gros-boutien : l'ordre des octets ne change pas un pixel |
| `rgb8-lzw.tiff`          | RGB 8 bits    | LZW (5)     | codes à longueur variable, mêmes pixels que le brut   |
| `rgb8-deflate.tiff`      | RGB 8 bits    | Deflate (8) | l'autre tag du même codec                             |
| `rgb8-packbits.tiff`     | RGB 8 bits    | PackBits (32773) | paquets répétés et paquets bruts                 |
| `rgba8-brut.tiff`        | RGBA 8 bits   | aucune (1)  | `ExtraSamples = 2` (alpha non associé) : les quatre octets passent tels quels, alpha nul compris |
| `gris8-brut.tiff`        | gris 8 bits   | aucune (1)  | noir à zéro, valeur recopiée sur les trois canaux, alpha 255 |

## Ce que le pilote refuse, et sous quel nom

| fichier                      | refus                      | pourquoi                                             |
| ---------------------------- | -------------------------- | ---------------------------------------------------- |
| `gris16.tiff`                | `image-depth-unsupported`  | 16 bits par composante : `DecodedImage` n'a que `Rgba8`, l'abaisser en silence ajouterait une perte |
| `palette8.tiff`              | `image-profile-unsupported`| `Photometric = 3` ; la bibliothèque de lecture n'étend pas les palettes TIFF |
| `rgb8-jpeg.tiff`             | `image-profile-unsupported`| JPEG-in-TIFF (compression 7)                          |
| `ccitt-g4.tiff`              | `image-profile-unsupported`| CCITT Group 4 (compression 4), bilevel                |
| `deux-pages.tiff`            | `image-profile-unsupported`| deux IFD : une seule page serait rendue, l'autre disparaîtrait sans rapport |
| `rgb8-plans-separes.tiff`    | `image-profile-unsupported`| `PlanarConfiguration = 2` : une bande par composante  |
| `rgba8-alpha-associe.tiff`   | `image-profile-unsupported`| `ExtraSamples = 1`, alpha prémultiplié : le rendre tel quel changerait les couleurs |
| `tronque.tif`                | `image-decode-failed`      | 31 octets sur 196 748 : l'entête est un entête TIFF, c'est la lecture qui échoue |

BigTIFF n'a pas de fichier : ses quatre premiers octets (`II+\0`, `MM\0+`) suffisent et sont écrits
dans la dorée. Le pilote les revendique pour nommer le refus plutôt que de laisser le fichier sortir
en format inconnu.

## Provenance et licence

Tous ces fichiers sont **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>), voir
[LICENSE.txt](LICENSE.txt) — redistribuables sans condition, aucun contenu de tiers.

- `rgb8-brut-ii.tiff`, `rgb8-brut-mm.tiff`, `rgb8-plans-separes.tiff` et `rgba8-alpha-associe.tiff`
  sont **écrits octet par octet** depuis la spécification publique « TIFF Revision 6.0 » (Adobe
  Developers Association, 3 juin 1992) : entête, IFD unique trié par tag, tableaux hors champ,
  bandes. Auteur : corpus WebGeometry, 2026-09-15.
- Les compressées et les pièges (`rgb8-lzw`, `rgb8-deflate`, `rgb8-packbits`, `rgb8-jpeg`,
  `rgba8-brut`, `gris8-brut`, `palette8`, `gris16`, `deux-pages`, `ccitt-g4`) sortent de **Pillow
  12.2.0**, encodeur extérieur à la bibliothèque que le pilote emploie pour lire : un piège doit
  venir d'ailleurs que du lecteur qu'il met à l'épreuve.
- `tronque.tif` est repris tel quel de `test/assets/limites/truncated-tif/truncated.tif` (corpus
  WebGeometry, généré par `test/assets/tools/texture_assets.py`). Le dossier `test/assets/` est
  livré hors git : le fichier est copié ici pour que la dorée n'en dépende pas.

Les pixels des quatorze fichiers ont été relus par **Pillow**, décodeur indépendant, avant d'être
commités : une erreur de l'encodeur et du décodeur à la fois ne passerait pas la double lecture.

Les trois TIFF 256 × 256 de `test/assets/textures/tiff-matrix/` (RGB8 brut, RGB8 LZW, gris16) et un
RGB8 en tuiles de 16 × 16 couvrent la même matrice à grande taille. Le pilote a été passé dessus
pendant le développement — sha256 des pixels RGBA8 identique à celui de Pillow pour les trois cas
lisibles, refus nommé pour le gris16. Ces fichiers ne sont pas commités ici : un quart de mégaoctet
de pixels qu'on ne peut pas écrire en clair n'est pas une fixture minimale.
