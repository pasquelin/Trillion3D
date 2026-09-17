# Fixture dorée — pilote Radiance HDR (RGBE)

Sept fichiers minuscules et une scène. Quatre portent la même image écrite de quatre façons ; trois
sont là pour être refusés, chacun par son nom.

| fichier                   | ce qu'il porte                                 | ce qu'il met sous surveillance                                                         |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `plat.hdr`                | 4 × 2, lignes brutes                           | quatre octets par pixel, sans aucun marqueur                                           |
| `rle-ancienne.hdr`        | 4 × 2, marqueurs `1,1,1,n`                     | la compression de « Real Pixels » : mêmes pixels que `plat.hdr`                        |
| `signature-rgbe.hdr`      | 4 × 2, signature `#?RGBE`                      | la seconde signature du format, que les fichiers anciens portent                       |
| `rle-nouvelle.hdr`        | 8 × 1, entête `2, 2, largeur`                  | la compression par composantes, ses plages **et** ses paquets bruts dans la même ligne |
| `xyze.hdr`                | `FORMAT=32-bit_rle_xyze`                       | un autre espace de couleur : refus `hdr-format-unsupported`                            |
| `bas-en-haut.hdr`         | résolution `+Y 2 +X 4`                         | une orientation qu'il faudrait retourner : refus `hdr-orientation-unsupported`         |
| `tronque.hdr`             | 7 des 32 octets de pixels                      | refus `hdr-data-truncated`, jamais une ligne à moitié                                  |
| `scene.gltf`, `scene.bin` | un quad dont la couleur de base est `plat.hdr` | le chemin complet jusqu'au rapport des aperçus, où la texture flottante est nommée     |

`src/plugins/tests/hdr.rs` compare les valeurs **une par une** à une référence écrite en clair dans
le test. Les quatre quadruplets RGBE employés ont des exposants lisibles à l'œil — `2^-8`, `2^-7`,
`2^0`, `2^4` — et des mantisses qui tombent juste : toutes les valeurs attendues sont exactes en
simple précision, donc un écart ne peut venir que du pilote.

Les trois fichiers 4 × 2 portent la même image : c'est la preuve que la compression et la signature
ne changent pas un bit du résultat. La fixture 8 × 1 en porte une autre, parce que la nouvelle
compression ne s'écrit qu'à partir de huit pixels de large — sa ligne mêle une plage de quatre
pixels identiques et des valeurs isolées, pour que les deux sortes de paquets soient exercées.

## `expected.json`

Le contrat d'image que ce binaire publie, le rapport des aperçus progressifs — un `skipped` qui
nomme `image-float-unsupported`, et aucun aperçu — et la scène : version de format, version du
sidecar binaire, sha256 de `clusters.bin`, primitives et triangles. `case` et `rule` ne sont que de
la prose, le test les retire avant de comparer.

## Provenance et licence

- Les sept HDR sont **écrits ici**, octet par octet, depuis la spécification publique du format :
  « Real Pixels » de Greg Ward (Graphics Gems II, 1991) pour l'encodage RGBE et ses deux
  compressions, et le manuel Radiance (Lawrence Berkeley National Laboratory) pour l'entête et la
  ligne de résolution. L'encodeur qui les a produits ne partage aucune ligne avec le décodeur du
  pilote. Aucun outil d'éditeur, aucun SDK. Auteur : corpus WebGeometry, 2026-09-15. Licence :
  **CC0-1.0** (<https://creativecommons.org/publicdomain/zero/1.0/>).
- La scène `scene.gltf` et son binaire sont écrits ici de la même façon, **CC0-1.0**.

Le `test/assets/textures/hdr-matrix/environment.hdr` (512 × 256, CC0-1.0, produit par un encodeur
tiers et relu par FFmpeg au moment de son entrée au corpus) couvre le cas d'un fichier écrit
ailleurs, avec la nouvelle compression sur une vraie largeur. Le pilote a été passé dessus pendant
le développement ; il n'est pas commis ici — un demi-mégaoctet de pixels qu'on ne peut pas écrire en
clair ne fait pas une fixture minimale. Il se décode en 512 × 256, avec des valeurs RGB comprises
entre 0 et 8 exactement — la même rampe linéaire 0..8 que le manifeste du corpus annonce et que
FFmpeg avait relue — et un alpha opaque partout.

## Provenance du lecteur

Lecteur écrit ici, dans `src/plugins/image/hdr.rs` et `src/plugins/image/hdr/scanlines.rs`, depuis
les mêmes sources publiques. Aucune bibliothèque tierce : la caisse `image` ne reconnaît que la
signature `#?RADIANCE` et ne laisse pas nommer ce qu'elle refuse, deux choses dont le pilote a
besoin.
