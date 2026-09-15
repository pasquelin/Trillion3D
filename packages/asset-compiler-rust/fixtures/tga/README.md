# Fixture dorée — pilote TGA

Sept fichiers minuscules, un par profil que le pilote `tga` doit lire sans perte, plus un fichier
tronqué qu'il doit refuser en le nommant. La dorée `src/plugins/tests/tga.rs` les décode et compare
les pixels RGBA8 **un par un** à une référence écrite en clair dans le test : une image de 4 × 2
pixels dont on connaît les huit valeurs.

| fichier | type d'image | profondeur | origine | ce qu'il met sous surveillance |
| --- | --- | --- | --- | --- |
| `vraies-couleurs-24-bas.tga` | 2 (brut) | 24 bits | basse | BGR → RGB, lignes retournées, alpha rempli à 255 |
| `vraies-couleurs-32-haut.tga` | 2 (brut) | 32 bits | haute | alpha conservé tel quel, pied « TRUEVISION-XFILE. » de la 2.0 |
| `vraies-couleurs-32-rle-haut.tga` | 10 (RLE) | 32 bits | haute | paquets répétés **et** paquets bruts, mêmes pixels que le brut |
| `vraies-couleurs-32-rle-bas.tga` | 10 (RLE) | 32 bits | basse | RLE et retournement de lignes ensemble |
| `palette-8-haut.tga` | 1 (brut) | 8 bits, palette 24 bits | haute | indices de palette résolus vers les mêmes couleurs |
| `niveaux-de-gris-8-bas.tga` | 3 (brut) | 8 bits | basse | gris étendu en RGB, alpha 255 |
| `tronque.tga` | 2 (brut) | 24 bits | basse | 31 octets sur 196 652 : entête reconnu, décodage refusé |

Les trois variantes 32 bits et la 24 bits portent la même image ; seule l'alpha de la 24 bits est
remplie, puisque le format n'en a pas. La dorée le vérifie explicitement : c'est la preuve que
l'origine, la compression et la profondeur ne changent pas un seul octet du résultat.

## Provenance et licence

- Les six images lisibles sont **écrites ici**, octet par octet, depuis la spécification publique
  « Truevision TGA File Format Specification, Version 2.0 ». Aucun outil d'éditeur, aucun SDK.
  Auteur : corpus WebGeometry, 2026-09-15. Licence : **CC0-1.0**
  (<https://creativecommons.org/publicdomain/zero/1.0/>), redistribuables sans condition.
  Leurs pixels ont été vérifiés par un décodeur indépendant (Pillow 12.2.0) avant d'être commités :
  une erreur de l'encodeur et du décodeur à la fois ne passerait pas la double lecture.
- `tronque.tga` est repris tel quel de `test-assets/limites/truncated-tga/truncated.tga`, lui aussi
  **CC0-1.0** (corpus WebGeometry, généré par `test-assets/tools/texture_assets.py`). Le dossier
  `test-assets/` est livré hors git : le fichier est copié ici pour que la dorée n'en dépende pas.

Les quatre TGA 256 × 256 de `test-assets/textures/tga-matrix/` (24 et 32 bits, brut et RLE, origines
haute et basse, CC0-1.0, produites par Pillow) couvrent la même matrice à grande taille. Le pilote a
été passé dessus pendant le développement ; elles ne sont pas commitées ici — un quart de mégaoctet
par fichier pour des pixels qu'on ne peut pas écrire en clair n'est pas une fixture minimale.
