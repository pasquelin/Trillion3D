# Fixture dorée — pilote PSD et PSB (composite aplati)

Douze fichiers minuscules et une scène. Cinq portent le même composite écrit de cinq façons, six
sont là pour être refusés — chacun par son nom —, et la scène mène l'un d'eux jusqu'au sidecar
binaire par le compilateur entier.

La politique d'import n'admet du PSD que le **composite aplati** : l'image que le fichier porte
déjà en fin de fichier, jamais des calques recomposés. Recomposer demanderait de refaire les modes
de fusion, les masques et les effets de l'éditeur, donc de produire une image que la source ne
contient pas.

## Ce que le pilote lit

| fichier              | ce qu'il porte                               | ce qu'il met sous surveillance                                                                                                                |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `rgb-brut.psd`       | 4 × 2, RVB 8 bits, compression 0             | les trois plans tels quels, un canal entier après l'autre                                                                                     |
| `rgb-rle.psd`        | 4 × 2, RVB 8 bits, compression 1             | PackBits : mêmes pixels que `rgb-brut.psd`, une plage et un paquet brut dans la même ligne                                                    |
| `rgba-rle.psd`       | 4 × 2, RVB + un plan de plus, compression 1  | rien ne déclare la transparence : le quatrième plan est un canal alpha enregistré, lu, écrit nulle part et compté `psd-alpha-channel-ignored` |
| `gris-brut.psd`      | 4 × 2, niveaux de gris 8 bits, compression 0 | l'unique canal de couleur porte les trois composantes, sans profil ni matrice                                                                 |
| `gris-alpha-rle.psd` | 4 × 2, gris + un plan de plus, compression 1 | le même cas dans un mode à un seul canal de couleur                                                                                           |
| `grand-format.psb`   | 4 × 2, RVB 8 bits, PSB, compression 1        | la version 2 du format : longueur de la section des calques sur huit octets, compte d'octets d'une ligne sur quatre                           |

Les cinq fichiers 4 × 2 portent le même composite — trois pixels identiques, un pixel isolé, puis
une couleur vive et une plage de gris. C'est la preuve que la compression, le mode de couleur et la
version du format ne changent pas un octet du résultat. `src/plugins/tests/psd.rs` compare les
pixels **un par un** à une référence écrite en clair dans le test.

## Le plan de plus : transparence ou sélection

Aucune des douze fixtures ne porte de section de calques : leur quatrième plan n'est donc **pas**
déclaré comme la transparence du document. C'est un canal alpha enregistré — une sélection —, que
le pilote lit pour avancer d'un plan et n'écrit nulle part, en le comptant sous
`psd-alpha-channel-ignored`. La dorée le dit maintenant tout haut : elle affirmait auparavant que
le plan suivant les canaux de couleur **était** l'alpha du composite, ce qui trouait une texture
dont le document ne portait qu'une sélection.

Le profil colorimétrique du document — sa ressource d'image 1039 — se construit de la même façon :
`src/plugins/tests/icc.rs` remplace la section de ressources vide de `rgb-brut.psd` par une section
qui porte cette ressource, une fois avec un profil qui se nomme sRGB, une fois avec un autre. Le
premier ne compte rien, le second compte `image-icc-profile-ignored` : ce lot ne convertit aucune
couleur, il dit ce qu'il ne convertit pas.

Le cas de la vraie transparence, et celui des calques, se construisent dans le test : il reprend
`rgba-rle.psd` et `rgb-rle.psd` et remplace leur section de calques vide par une section qui porte
un compte de calques, l'entier signé de seize bits par lequel la spécification d'Adobe déclare, par
son signe, que le premier plan d'alpha du composite est la transparence du document. Le pilote ne
lit que ce champ et saute le reste de la section par sa longueur : ces cas ne prétendent donc pas
écrire un enregistrement de calque entier, ils mettent en défaut exactement le champ qui décide.

## Ce que le pilote refuse, et sous quel nom

| fichier              | refus                         | pourquoi                                                                                                 |
| -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `seize-bits.psd`     | `psd-depth-unsupported`       | seize bits par canal : les ramener à huit serait une perte que la source n'avait pas                     |
| `cmjn.psd`           | `psd-color-mode-unsupported`  | mode CMJN : le convertir demanderait un profil que le pilote choisirait à la place de la source          |
| `canaux-en-trop.psd` | `psd-channels-unsupported`    | deux plans de plus que les canaux de couleur : rien dans l'entête ne dit lequel est une transparence     |
| `zip.psd`            | `psd-compression-unsupported` | composite compressé par ZIP, hors du sous-ensemble brut et PackBits                                      |
| `sans-composite.psd` | `psd-composite-missing`       | le fichier s'arrête après la section des calques : pas d'image aplatie à lire, et on ne la recompose pas |
| `tronque.psd`        | `psd-data-truncated`          | 7 des 24 octets de pixels : jamais un plan à moitié                                                      |

Le test ajoute un cas qui n'a pas besoin de fichier : `rgb-brut.psd` dont la largeur est mise à
zéro, refusé en `psd-header-invalid`, et une signature dont le numéro de version est inconnu, que le
pilote ne revendique pas du tout.

## La scène

`scene.gltf` et `scene.bin` sont le quad de `fixtures/hdr/`, sa couleur de base remplacée par
`rgb-brut.psd`. `src/tests/psd_golden.rs` la compile par le harnais commun et compare chaque octet
de ses aperçus progressifs à `expected.json` : un composite de huit bits par canal y entre comme
toute autre source RGBA8, sans refus au rapport. La régénération de l'attendu est décrite dans
l'entête de ce test.

## Provenance et licence

- Les douze fichiers sont **écrits ici**, octet par octet, depuis la spécification publiée par Adobe
  pour les lecteurs tiers — « Adobe Photoshop File Formats Specification » — : entête de vingt-six
  octets, trois sections à longueur préfixée, section de données composites, et la compression par
  plages PackBits. L'encodeur qui les a produits ne partage aucune ligne avec le décodeur du pilote.
  Aucun fichier d'éditeur, aucun SDK, aucun document sous licence restrictive n'a été copié.
  Auteur : corpus WebGeometry, 2026-09-15. Licence : CC0-1.0, texte dans `LICENSE.txt`.
- `scene.gltf` et `scene.bin` reprennent la géométrie de la dorée `fixtures/hdr/`, du même corpus et
  sous la même licence.
- Le corpus hors dépôt `test-assets/textures/legacy-web-matrix/flattened.psd` (256 × 256, RVB 8 bits
  à surface brute) a servi à vérifier le pilote sur un vrai fichier : son composite décodé est
  identique, pixel par pixel, au `rgb24.bmp` posé à côté, qui porte la même image.
