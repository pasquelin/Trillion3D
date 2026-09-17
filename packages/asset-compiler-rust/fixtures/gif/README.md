# Fixture dorée — pilote GIF, une seule image

La politique de fidélité du dépôt n'admet ici qu'une **image fixe** : un fichier qui porte plus d'un
descripteur d'image est refusé en le nommant, jamais aplati sur une image choisie d'office. La
fixture suit cette coupe — trois fichiers que le pilote lit, deux qu'il doit refuser. La dorée
`src/plugins/tests/gif.rs` décode les premiers et compare les pixels RGBA8 **un par un** à une
référence écrite en clair dans le test : une image de 4 × 2 pixels dont on connaît les huit valeurs.
La dorée `src/tests/bmp_gif_golden.rs` reprend `palette-globale.gif` par le compilateur entier et
fixe les octets de ses aperçus dans `expected.json`.

## Ce que le pilote lit

| fichier               | table de couleurs  | ce qu'il met sous surveillance                                                              |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `palette-globale.gif` | globale, 8 entrées | les couleurs de la table rendues telles quelles — le format est indexé, rien n'est arrondi  |
| `palette-locale.gif`  | locale, 8 entrées  | une table portée par le descripteur d'image, sans aucune table globale dans le fichier      |
| `transparence.gif`    | globale, 8 entrées | l'index déclaré transparent devient un alpha nul, **et sa couleur reste celle de la table** |

Les trois portent la même image ; seul `transparence.gif` en change l'alpha, et lui seul. La dorée
le vérifie explicitement : d'où vient la table ne change pas un pixel, et la transparence ne touche
pas la couleur — rien n'est effacé, rempli de blanc ni prémultiplié.

## Ce que le pilote refuse, et sous quel nom

| fichier       | refus                         | pourquoi                                                                                                                                                                                                                                                     |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anime.gif`   | `image-animation-unsupported` | deux descripteurs d'image : une animation n'est pas une texture, et en choisir une image d'office serait arbitraire. C'est la raison du pilote `webp`, partagée exprès — un refus d'animation est un refus d'animation, quel que soit le format qui la porte |
| `tronque.gif` | `image-decode-failed`         | 31 octets sur 17 976 : la signature est reconnue, le décodage refusé                                                                                                                                                                                         |

La dorée ajoute trois cas qui n'ont pas besoin d'un fichier de plus, tirés des deux précédents :
la signature `GIF87a` réécrite sur `palette-globale.gif` — la version sans extensions, que le
parcours des blocs doit traverser aussi bien que la 89a —, `anime.gif` coupé à la fin de sa première
image, qui est alors **accepté** (une image entière sans octet de fin reste une image), et le même
coupé quatre octets plus loin, où le second séparateur d'image suffit à prouver l'animation même si
son descripteur est tronqué.

### Ce que le compte des images ignorées n'est pas

Le pilote ne publie pas combien d'images il a laissées de côté : il n'en laisse aucune, puisqu'il
refuse le fichier entier. Nommer ce compte demanderait un canal de rapport **du côté du succès**,
que le contrat `image-plugin-2` n'a pas — `ImageDecoder::decode` ne nomme une raison que dans son
`Err`, et `texture_preview` ne compte que celles-là. C'est un chantier de contrat, pas de pilote.

## Provenance et licences

- Les quatre fichiers lisibles ou refusés pour leur structure sont **écrits ici**, octet par octet,
  depuis la spécification publique « Graphics Interchange Format, Version 89a » (CompuServe, 1990) :
  entête, descripteur d'écran logique, tables de couleurs, extension de contrôle graphique,
  descripteurs d'image et flux LZW. Aucun outil d'éditeur, aucun SDK. Auteur : corpus WebGeometry,
  2026-09-15. Licence : **CC0-1.0**, voir [LICENSE.txt](LICENSE.txt).
- Leur flux LZW est le plus simple que la spécification admette : un code d'effacement, les
  littéraux, un code de fin. Aucun motif n'est appris, mais le décodeur en apprend un par code lu :
  la largeur de code grandit donc d'un bit chaque fois que sa table atteint une puissance de deux,
  et l'écrivain suit cette largeur. Un flux écrit à largeur fixe est illisible dès le huitième code.
- Leurs pixels ont été vérifiés par un décodeur indépendant (Pillow 12.2.0) avant d'être commités,
  compte d'images compris : une erreur de l'écrivain et du décodeur à la fois ne passerait pas la
  double lecture.
- `tronque.gif` est repris tel quel de `test/assets/limites/truncated-gif/truncated.gif`, lui aussi
  **CC0-1.0** (corpus WebGeometry). Le dossier `test/assets/` est livré hors git : le fichier est
  copié ici pour que la dorée n'en dépende pas.
- `scene.gltf` et `scene.bin` — le quad de la dorée du chemin complet — sont le quad de
  `fixtures/hdr/`, même corpus et même licence, avec sa seule image changée.

Le GIF 256 × 256 de `test/assets/textures/legacy-web-matrix/palette.gif` (CC0-1.0) couvre la même
lecture à grande taille ; le pilote en rend 256 × 256. Il porte la même image de référence que le
`rgb24.bmp` du même dossier, mais **quantifiée à la source** par son encodeur : le comparer pixel à
pixel au BMP dirait la perte de cet encodeur, pas celle du pilote. Il n'est pas commité ici.
