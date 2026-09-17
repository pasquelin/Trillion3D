# Fixture dorée — pilote DDS

La dorée `src/plugins/tests/dds.rs` travaille sur deux matières.

## 1. Un bloc de 4 × 4 pixels par codec, écrit dans le test

Les conteneurs minuscules ne sont pas des fichiers : ils sont construits octet par octet par
`src/plugins/tests/dds/bytes.rs`, champ de `DDS_HEADER` par champ de `DDS_HEADER`, et chaque bloc
porte des bornes dont la reconstruction est calculée à la main d'après la spécification.

| codec | comment il est nommé | ce qu'il met sous surveillance |
| --- | --- | --- |
| BC1 | `DXT1`, puis `DXGI_FORMAT_BC1_UNORM` | les deux bornes 565 et les tiers entiers `(2·c0 + c1)/3` |
| BC2 | `DXT3` | l'alpha explicite de quatre bits, étendu en `v << 4 \| v` |
| BC3 | `DXT5` | la rampe d'alpha de trois bits et ses six septièmes entiers |
| BC4 | `ATI1` | un seul canal interpolé, rendu en rouge, le reste à zéro et alpha 255 |
| BC5 | `ATI2` | deux rampes indépendantes, en rouge et en vert |
| BC7 | `DXGI_FORMAT_BC7_UNORM` | le mode 6 : bornes de sept bits, bit P, indices de quatre bits |
| RGBA8, BGRA8, BGRX8 | masques de bits, puis `dxgiFormat` | l'ordre des octets, et l'opacité de `BGRX8` |

Les deux blocs BC7 extrêmes sont posés sur les indices 0 et 15, dont les poids valent 0 et 64 :
la référence ne contient donc aucune valeur interpolée, seulement les bornes elles-mêmes.

## 2. Deux fichiers réels, repris du corpus

| fichier | origine | ce qu'il prouve |
| --- | --- | --- |
| `bc1-mips.dds` | `test/assets/textures/dds-matrix/bc1-mips.dds` | un entête écrit par un encodeur tiers se lit ; 256 × 256, neuf niveaux, seul le niveau 0 ressort ; la chaîne est comptée, un octet en moins et le fichier est refusé |
| `tronque.dds` | `test/assets/limites/truncated-dds/truncated.dds` | 31 octets sur 43 832 : le nombre magique est là, l'entête non, et le refus est nommé |

Les deux sont **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>), corpus
WebGeometry, générés par `test/assets/tools/texture_assets.py` le 15 septembre 2026, et leurs
niveaux ont été relus par un décodeur indépendant (Pillow 12.2.0) avant d'entrer au corpus. Le
dossier `test/assets/` est livré hors git : ils sont copiés ici pour que la dorée n'en dépende pas.

Les `bc3-mips.dds`, `bc5-mips.dds`, `bc7-mips.dds` et `bc1-no-mips.dds` du même dossier couvrent la
même matrice à grande taille. Le pilote a été passé dessus pendant le développement : les cinq
fichiers se décodent, en 256 × 256, avec des blocs constants de bout en bout. Ils ne sont pas
commités — deux cent cinquante kilooctets de pixels qu'on ne peut pas écrire en clair ne font pas
une fixture minimale, et les blocs du test ci-dessus disent la même chose exactement.

## Provenance du lecteur

- Entêtes `DDS_HEADER`, `DDS_PIXELFORMAT`, `DDS_HEADER_DXT10` et valeurs `DXGI_FORMAT` : écrits
  depuis la documentation publique « DDS — Programming Guide » de Microsoft. Aucun SDK d'éditeur.
- Reconstruction des blocs : crate `texture2ddecoder` 0.1.2, MIT ou Apache-2.0,
  `UniversalGameExtraction/texture2ddecoder`, Rust pur, notices conservées avec la dépendance.
