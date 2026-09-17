# Fixture dorée — pilote BMP

Huit fichiers minuscules, un par écriture du format que le pilote `bmp` doit lire **sans perte**,
plus trois qu'il doit refuser en les nommant. La dorée `src/plugins/tests/bmp.rs` les décode et
compare les pixels RGBA8 **un par un** à une référence écrite en clair dans le test : une image de
4 × 2 pixels dont on connaît les huit valeurs. La dorée `src/tests/bmp_gif_golden.rs` reprend l'une
d'elles par le compilateur entier et fixe les octets de ses aperçus dans `expected.json`.

## Ce que le pilote lit

| fichier                       | entête | profondeur                   | ordre des lignes | ce qu'il met sous surveillance                               |
| ----------------------------- | ------ | ---------------------------- | ---------------- | ------------------------------------------------------------ |
| `vraies-couleurs-24-bas.bmp`  | Info   | 24 bits `BI_RGB`             | bas-haut         | BGR → RGB, lignes remises dans l'ordre, alpha rempli à 255   |
| `vraies-couleurs-32-haut.bmp` | V3     | 32 bits `BI_BITFIELDS`       | haut-bas         | masque alpha de l'entête V3, alpha droit conservé (128 et 0) |
| `palette-8.bmp`               | Info   | 8 bits, palette de 8 entrées | bas-haut         | indices résolus vers les mêmes couleurs                      |
| `palette-8-rle.bmp`           | Info   | 8 bits `BI_RLE8`             | bas-haut         | mode absolu, fins de ligne et fin de bitmap                  |
| `palette-4.bmp`               | Info   | 4 bits, palette de 8 entrées | bas-haut         | deux indices par octet, bourrage de ligne à quatre octets    |
| `palette-1.bmp`               | Info   | 1 bit, palette de 2 entrées  | bas-haut         | un indice par bit ; sa référence est un damier               |
| `r5g5b5.bmp`                  | Info   | 16 bits `BI_RGB`             | bas-haut         | les masques 5-5-5 par défaut, sans champ de masque           |
| `r5g6b5.bmp`                  | Info   | 16 bits `BI_BITFIELDS`       | bas-haut         | masques 5-6-5 lus derrière l'entête, six bits sur le vert    |

Les huit portent la même image — sauf `palette-1.bmp`, qu'un seul bit réduit à deux couleurs, et
`vraies-couleurs-32-haut.bmp`, seul à porter un alpha. La dorée le vérifie explicitement : ni la
profondeur, ni la palette, ni la compression, ni l'ordre des lignes ne changent un octet du
résultat.

### Pourquoi les 16 bits entrent sans perte

Le décodeur porte un canal de `n` bits vers huit par `round(v × 255 / (2^n − 1))` : une mise à
l'échelle proportionnelle arrondie au plus proche, et **non** une recopie de bits. Elle convient
quand même, et pour une raison qui ne dépend pas de la formule : la table est strictement
croissante, donc injective, donc inversible. Les 32 valeurs d'un canal de 5 bits tombent sur
32 valeurs de 8 bits distinctes, et le chemin retour rend la valeur d'origine — aucune information
de la source n'est perdue.

C'est aussi pourquoi les huit composantes de la référence valent 0, 8, 16, 49, 66, 132, 206, 239,
247 ou 255 : ce sont des valeurs que les tables de 5 **et** de 6 bits atteignent exactement, donc
les deux écritures 16 bits rendent ces octets-là et pas leurs voisins.

## Ce que le pilote refuse, et sous quel nom

| fichier               | refus                            | pourquoi                                                                                              |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `masques-10-bits.bmp` | `bmp-bitfields-lossy`            | 32 bits à masques 10-10-10 : le décodeur ne garderait que les huit bits de poids fort de chaque canal |
| `jpeg-embarque.bmp`   | `bmp-embedded-codec-unsupported` | `BI_JPEG` : le fichier n'emballe pas des pixels mais un format entier, qui a son propre pilote        |
| `tronque.bmp`         | `image-decode-failed`            | 31 octets sur 196 662 : entête reconnu, lecture des pixels refusée                                    |

La dorée ajoute deux refus qu'aucun fichier ne porte, obtenus en réécrivant deux champs d'un entête
lisible : une profondeur de 64 bits (`bmp-depth-unsupported`) et la compression
`BI_ALPHABITFIELDS` (`bmp-compression-unsupported`).

## Provenance et licences

- Les dix fichiers lisibles ou refusés pour leur entête sont **écrits ici**, octet par octet, depuis
  les structures publiques `BITMAPFILEHEADER`, `BITMAPINFOHEADER` et `BITMAPV3HEADER` documentées
  par Microsoft (« Bitmap Header Types »). Aucun outil d'éditeur, aucun SDK. Auteur : corpus
  WebGeometry, 2026-09-15. Licence : **CC0-1.0**, voir [LICENSE.txt](LICENSE.txt).
- Leurs pixels ont été vérifiés par un décodeur indépendant (Pillow 12.2.0) avant d'être commités :
  une erreur de l'écrivain et du décodeur à la fois ne passerait pas la double lecture. Les deux
  fichiers 16 bits ont été vérifiés autrement, et il faut le dire : Pillow étend un canal de `n`
  bits par `(v × 255) ÷ (2^n − 1)` **tronqué**, là où la crate `image` arrondit. Ce sont donc les
  *indices stockés* qui ont été confrontés à la convention de Pillow, pas les octets rendus — les
  deux conventions étant injectives, aucune ne perd d'information, mais elles ne donnent pas les
  mêmes valeurs à un bit près.
- `tronque.bmp` est repris tel quel de `test/assets/limites/truncated-bmp/truncated.bmp`, lui aussi
  **CC0-1.0** (corpus WebGeometry). Le dossier `test/assets/` est livré hors git : le fichier est
  copié ici pour que la dorée n'en dépende pas.
- `scene.gltf` et `scene.bin` — le quad de la dorée du chemin complet — sont le quad de
  `fixtures/hdr/`, même corpus et même licence, avec sa seule image changée.

Le BMP 256 × 256 en vraies couleurs 24 bits de `test/assets/textures/legacy-web-matrix/rgb24.bmp`
(CC0-1.0) couvre la même lecture à grande taille. Le pilote a été passé dessus pendant le
développement — il en rend 256 × 256 ; il n'est pas commité ici, un quart de mégaoctet pour des
pixels qu'on ne peut pas écrire en clair n'étant pas une fixture minimale.
