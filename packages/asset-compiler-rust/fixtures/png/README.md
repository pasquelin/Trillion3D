# Fixture dorée — pilote PNG

Trois fichiers minuscules, moins de cent octets chacun, qui portent **le même dessin de 2 × 2
pixels** écrit dans trois profondeurs. La dorée `src/plugins/tests/png.rs` les passe au registre
d'images et compare le résultat à une référence écrite en clair dans le test.

| fichier        | type de couleur | profondeur              | ce qu'il met sous surveillance                                   |
| -------------- | --------------- | ----------------------- | ---------------------------------------------------------------- |
| `rgb8.png`     | 2 (RGB)         | 8 bits par canal        | le cas courant : décodé, alpha rempli à 255, pixels inchangés    |
| `palette4.png` | 3 (palette)     | 4 bits, palette 24 bits | sous huit bits l'expansion vers RGBA8 recopie, elle ne perd rien |
| `rgb16.png`    | 2 (RGB)         | 16 bits par canal       | refusé sous `image-depth-unsupported`, avant tout décodage       |

Le dessin est le même partout : rouge, vert sur la ligne du haut, bleu, jaune sur celle du bas. Les
deux fixtures lisibles doivent donc rendre exactement les mêmes quatre pixels — c'est la preuve que
la profondeur est une façon d'écrire l'image, jamais de la changer.

`rgb16.png` porte, dans l'octet de poids faible de chacune de ses douze composantes, une valeur non
nulle et différente (`0x11`, `0x22`, … `0xCC`), tandis que ses octets de poids fort reprennent la
référence. C'est voulu : un `to_rgba8()` sur cette source rendrait la référence sans broncher, et
les douze octets de précision disparaîtraient sans un mot. La dorée vérifie qu'on n'en arrive
jamais là — le pilote lit la profondeur dans l'IHDR et refuse avant de décoder.

## Provenance et licence

Les trois fichiers sont **écrits ici**, morceau par morceau (IHDR, PLTE, IDAT, IEND, longueurs et
CRC-32 compris), depuis la spécification publique « Portable Network Graphics (PNG) Specification
(Second Edition) », W3C / ISO-IEC 15948:2004. Aucun outil d'éditeur, aucun SDK, aucune image
reprise. Auteur : corpus WebGeometry, 2026-09-15. Licence : **CC0-1.0**
(<https://creativecommons.org/publicdomain/zero/1.0/>), redistribuables sans condition.

Leurs pixels ont été relus par un décodeur indépendant (Pillow 12.2.0) avant d'être commités : les
trois rendent bien la même image, et `rgb16.png` s'y voit justement abaissé en silence à la
référence 8 bits — le symptôme que ce pilote refuse désormais.

Les cinq PNG 256 × 256 de `test-assets/textures/png-matrix/` (gris, palette, RGB 8 bits, RGBA 8 bits
à alpha binaire, RGB 16 bits, CC0-1.0) couvrent la même matrice à grande taille ; le pilote a été
passé dessus pendant le développement, lu en place, jamais modifié. Un seul fichier change de
comportement, celui que la décision visait ; les quatre autres rendent ce que leur type de couleur
annonce :

| fichier            | type de couleur | profondeur | verdict                           |
| ------------------ | --------------- | ---------- | --------------------------------- |
| `rgb8.png`         | 2 (RGB)         | 8 bits     | décodé                            |
| `rgba8-binary.png` | 6 (RGBA)        | 8 bits     | décodé, alpha conservé            |
| `palette.png`      | 3 (palette)     | 8 bits     | décodé                            |
| `gray.png`         | 0 (gris)        | 8 bits     | décodé                            |
| `rgb16.png`        | 2 (RGB)         | 16 bits    | refusé, `image-depth-unsupported` |

Elles ne sont pas commitées ici : cent quarante kilooctets pour des pixels qu'on ne peut pas écrire
en clair ne font pas une fixture minimale, et le dossier `test-assets/` est livré hors git.
