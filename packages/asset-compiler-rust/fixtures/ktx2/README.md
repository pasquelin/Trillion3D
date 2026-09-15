# Fixture dorée — pilote KTX 2.0

La dorée travaille sur deux matières : les cinq fichiers de ce dossier, et les conteneurs minuscules
que `src/plugins/tests/ktx2/bytes.rs` écrit champ par champ depuis la spécification de Khronos.

## 1. Les cinq fichiers

| fichier | ce qu'il porte | ce qu'il prouve |
| --- | --- | --- |
| `base.ktx2` | 4 × 4, `VK_FORMAT_R8G8B8A8_SRGB`, `supercompressionScheme` 0 | un niveau non compressé ressort octet pour octet ; ses seize texels sont écrits en clair dans `src/plugins/tests/ktx2.rs` |
| `base-zstd.ktx2` | le même niveau sous `KTX_SS_ZSTD` | la supercompression n'est qu'un emballage : défaite, elle rend exactement les mêmes texels |
| `uastc.ktx2` | 16 × 16, `VK_FORMAT_UNDEFINED`, charge UASTC LDR 4 × 4 | le chemin Basis Universal sans supercompression, seize blocs de seize octets |
| `basis.ktx2` | 256 × 256, `VK_FORMAT_UNDEFINED`, charge ETC1S sous `KTX_SS_BASIS_LZ` | le chemin Basis Universal supercompressé, codebooks compris, tel qu'un encodeur tiers l'écrit |
| `tronque.ktx2` | quarante octets de `basis.ktx2` | l'identifiant est là, l'entête non, et le refus est nommé |

`scene.gltf`, `scene.bin` et `expected.json` sont la dorée compilée : trois quads, un matériau
opaque et une texture par fichier de la première moitié du tableau, passés par le compilateur entier.
Leur régénération est décrite dans l'entête de `src/tests/ktx2_golden.rs`.

## Provenance et licence

Tout ce dossier est sous **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>), voir
[LICENSE.txt](LICENSE.txt).

- `basis.ktx2` est copié tel quel de `test-assets/textures/ktx2-matrix/basis.ktx2`, corpus
  WebGeometry, écrit par `ktx create v4.4.2 / libktx v4.4.2` le 15 septembre 2026. Le dossier
  `test-assets/` est livré hors git : le fichier est copié ici pour que la dorée n'en dépende pas.
- `uastc.ktx2` est **découpé** dans `test-assets/textures/ktx2-matrix/uastc.ktx2` du même corpus :
  les blocs UASTC font seize octets, sont indépendants les uns des autres et rangés par rangées, donc
  les quatre premiers blocs des quatre premières rangées sont exactement le coin supérieur gauche de
  16 × 16 texels de la source, sans le moindre réencodage. L'entête reprend celui de la source avec
  `pixelWidth` et `pixelHeight` à 16, sans clés, le descripteur de format recopié à l'octet 104 et le
  niveau à l'octet 160 — le multiple de seize que la spécification exige pour un bloc de seize octets.
- `base.ktx2` et `base-zstd.ktx2` sont écrits depuis la spécification : entête de quatre-vingts
  octets, index d'un niveau, descripteur de format R8G8B8A8 sRGB repris du corpus, puis le niveau à
  l'octet 196. Leurs seize texels valent `[x·85, y·85, (x+y)·42, 255 − (x+y)·17]`. Le niveau de
  `base-zstd.ktx2` est la même suite d'octets passée par un encodeur Zstandard de référence.

## Provenance du lecteur

- Entête, index des sections et index des niveaux : écrits depuis « KTX File Format Specification,
  version 2.0 » de Khronos. Aucun SDK d'éditeur.
- Charges Basis Universal : crate `basisu` 0.1.0, Apache-2.0, `marcogomez/basisu`, Rust pur, portage
  du transcodeur de référence de Binomial vérifié octet pour octet contre lui.
- Blocs déjà compressés pour le GPU : crate `texture2ddecoder` 0.1.2, MIT ou Apache-2.0, par le socle
  `image::blocks` partagé avec le pilote `dds`.
- Supercompression Zstandard : crate `ruzstd` 0.7.3, MIT, Rust pur, décompression seule.

## Ce que la dorée fixe, et ce qu'elle ne fixe pas

Les texels sont écrits en clair pour le non compressé, pour BC1 en trois couleurs — le seul cas où le
bit d'alpha sépare `BC1_RGB` de `BC1_RGBA` — et pour un bloc ASTC 4 × 4 « void extent », dont la
couleur est écrite en clair dans le bloc. Pour les autres codecs nommés par `vkFormat`, la dorée fixe
le routage et la géométrie du bloc, prouvée par l'octet qui manque : l'interpolation entière des
blocs BCn est déjà fixée bloc par bloc par la dorée du pilote `dds`, qui passe par le même socle et
le même décodeur, et celle des ETC2, EAC et ASTC appartient à `texture2ddecoder`.
