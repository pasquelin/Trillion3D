# Fixture dorée — pilote WebP, sans perte uniquement

La politique d'import n'admet WebP que **sans perte** : un flux avec perte n'est ni réencodé ni
décodé, il est refusé en le nommant. La fixture suit cette coupe — deux fichiers que le pilote lit,
trois qu'il doit refuser. La dorée `src/plugins/tests/webp.rs` décode les premiers, compare les deux
écritures du même flux **octet pour octet** et vérifie cinq texels écrits en clair dans le test.

## Ce que le pilote lit

| fichier                  | conteneur                | ce qu'il met sous surveillance                                        |
| ------------------------ | ------------------------ | --------------------------------------------------------------------- |
| `sans-perte.webp`        | `VP8L` seul              | 256 × 256 RGBA8, alpha nul et alpha opaque mêlés : rien n'est rempli d'office ni prémultiplié |
| `etendu-sans-perte.webp` | `VP8X` + `ICCP` + `VP8L` | les chunks de métadonnées sont franchis sans toucher un pixel : les octets rendus sont ceux du `VP8L` seul |

## Ce que le pilote refuse, et sous quel nom

| fichier            | refus                          | pourquoi                                                          |
| ------------------ | ------------------------------ | ----------------------------------------------------------------- |
| `avec-perte.webp`  | `image-lossy-unsupported`      | `VP8X` + `ALPH` + `VP8 ` : le flux avec perte est *derrière* des chunks facultatifs, le pilote doit parcourir le conteneur et non regarder le premier chunk |
| `anime.webp`       | `image-animation-unsupported`  | `VP8X` + `ANIM` + `ANMF` : aplatir une animation sur une image choisie d'office serait arbitraire, pas une lecture fidèle |
| `tronque.webp`     | `image-decode-failed`          | 40 des 192 octets : la taille annoncée par `RIFF` dépasse ce que le fichier porte, on ne tend pas au décodeur un flux amputé |

Le test ajoute deux cas qui n'ont pas besoin de fichier : un `VP8L` dont le nom de chunk est réécrit
en `VP8 ` — le flux avec perte sans conteneur étendu, refusé par le même chemin — et un entête RIFF
d'un autre type de formulaire, que le pilote ne revendique pas du tout.

## Provenance et licences

- `sans-perte.webp` et `avec-perte.webp` sont repris tels quels de
  `test/assets/textures/legacy-web-matrix/` (`lossless.webp`, 184 octets, et `lossy.webp`), corpus
  WebGeometry produit par `test/assets/tools/texture_assets.py`, **CC0-1.0**, voir
  [LICENSE.txt](LICENSE.txt). `test/assets/` est livré hors git : les octets sont recopiés ici pour
  que la dorée tienne sans lui.
- `etendu-sans-perte.webp`, `anime.webp` et `tronque.webp` sont **dérivés de `sans-perte.webp`** :
  son chunk `VP8L` remis dans un conteneur étendu, puis dans une image d'animation, et le fichier
  coupé. Même licence, même origine. Ils se régénèrent en réassemblant les chunks RIFF d'après la
  « WebP Container Specification » publique — aucun encodeur n'intervient, aucun pixel n'est réécrit.
- Les pixels de `sans-perte.webp` et de `etendu-sans-perte.webp` ont été vérifiés identiques par un
  décodeur indépendant (Pillow 12.2.0) avant d'être commis ; les cinq texels écrits en clair dans la
  dorée en viennent.
