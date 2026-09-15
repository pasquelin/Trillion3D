# Fixture dorée — pilote OpenEXR

Six fichiers minuscules et une scène. Deux fichiers portent la même image dans les deux précisions
du sous-ensemble ; quatre sont là pour être refusés, chacun par son nom.

| fichier | ce qu'il porte | ce qu'il met sous surveillance |
| --- | --- | --- |
| `demi.exr` | 2 × 2, canaux `A`, `B`, `G`, `R` en demi-flottant | l'ordre de lecture, les quatre canaux, un alpha qui n'est ni 0 ni 1 |
| `flottant.exr` | 2 × 2, canaux `B`, `G`, `R` en simple flottant | les mêmes valeurs RGB que `demi.exr` — le demi s'étend sans arrondi — et l'alpha opaque que la spécification impose quand le canal manque |
| `canaux-xyz.exr` | 2 × 2, canaux `X`, `Y`, `Z` | un jeu de canaux d'un autre nom : refus `exr-channels-unsupported` |
| `profond.exr` | `demi.exr` au drapeau de données profondes | le champ de version suffit : refus `exr-deep-unsupported` avant toute autre lecture |
| `multi-parties.exr` | `demi.exr` au drapeau multi-parties | refus `exr-multipart-unsupported` : rien ne dit quelle partie est la texture |
| `tronque.exr` | 40 des 395 octets de `demi.exr` | le nombre magique est là, l'entête non : refus `exr-header-invalid` |
| `scene.gltf`, `scene.bin` | un quad dont la couleur de base est `demi.exr` | le chemin complet jusqu'au rapport des aperçus, où la texture flottante est nommée |

Les deux fichiers lisibles portent la même image RGB, et `src/plugins/tests/exr.rs` compare leurs
valeurs **une par une** à une référence écrite en clair dans le test. Les valeurs choisies — 0, ⅛,
¼, ½, ¾, 1, 1,5, 2, 3, 4, 8, 16 — sont exactes en demi comme en simple précision : un écart ne peut
venir que du pilote, jamais de l'encodage.

Les deux fichiers à drapeau ne diffèrent de `demi.exr` que par le champ de version, celui-là même
que la spécification définit pour annoncer des parties profondes ou multiples. C'est exactement ce
que le pilote lit pour refuser : quatre octets, avant d'ouvrir l'entête. Un vrai fichier profond
porterait en plus ses attributs `type` et `version` et des morceaux d'une autre forme — le refus
tomberait plus tôt encore.

## `expected.json`

Le contrat d'image que ce binaire publie, le rapport des aperçus progressifs — un `skipped` qui
nomme `image-float-unsupported`, et aucun aperçu — et la scène : version de format, version du
sidecar binaire, sha256 de `clusters.bin`, primitives et triangles. `case` et `rule` ne sont que de
la prose, le test les retire avant de comparer.

## Provenance et licence

- Les six EXR sont **écrits ici**, octet par octet, depuis les spécifications publiques de
  l'Academy Software Foundation — « OpenEXR File Layout » et « Technical Introduction to OpenEXR »,
  <https://openexr.com/> — par un encodeur qui ne partage aucune ligne avec le décodeur du pilote :
  compression absente, une ligne par morceau, table des offsets calculée. Aucun outil d'éditeur,
  aucun SDK. Auteur : corpus WebGeometry, 2026-09-15. Licence : **CC0-1.0**
  (<https://creativecommons.org/publicdomain/zero/1.0/>), redistribuables sans condition.
- La scène `scene.gltf` et son binaire sont écrits ici de la même façon, **CC0-1.0**.

Les deux EXR 256 × 256 de `test-assets/textures/hdr-matrix/` (`float16.exr` et `float32.exr`,
CC0-1.0, produits par un encodeur tiers et relus par FFmpeg au moment de leur entrée au corpus)
couvrent le cas d'un fichier écrit ailleurs. Le pilote a été passé dessus pendant le développement ;
ils ne sont pas commis ici — huit cent mille octets de pixels qu'on ne peut pas écrire en clair ne
font pas une fixture minimale. Les dimensions et les bornes relevées sont dans
`orchestration/JOURNAL.md`.

## Provenance du lecteur

Caisse `exr` 1.74.2 (BSD-3-Clause, `johannesvollmer/exrs`), Rust pur et sans `unsafe`, version figée
dans `Cargo.toml`, notices conservées avec la dépendance. Le champ de version — drapeaux profond et
multi-parties — et le jeu de canaux sont lus par le pilote lui-même, d'après la spécification.
