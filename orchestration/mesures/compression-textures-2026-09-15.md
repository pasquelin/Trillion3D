# Comparatif de compression des textures, lot 4 — 2026-09-15

Commit de base `8cb7e215c3d18e1515d7fa1f9ae379400cb75a1b` · Apple M2 Max 12 cœurs, darwin 25.6.0 ·
rustc 1.98.1 (48a229cea 2026-09-01) · Node v26.8.2 · crates par cargo seulement : `image` 0.25.10,
`zstd` 0.13.3 (zstd 1.5.7), `intel_tex_2` 0.4.0 (ISPC d'Intel), `basisu_c_sys` 0.9.0 qui embarque
**Basis Universal 2.50** avec son encodeur, `texture2ddecoder` 0.1.2.

**Machine chargée par d'autres agents pendant les mesures** : load 1 min de 11 à 132 sur les passes
A et B, de 14 à 84 sur les passes C, D et E. Les octets n'en dépendent pas ; **les temps CPU si**,
et ils sont donnés tels que mesurés, jamais normalisés. FPS, DPR et résolution : sans objet, ce sont
des calculs CPU hors moteur. Détail par image et par genre dans le `.json` du même nom.

## Corpus

Les 336 images que le `source.gltf` du cache Emerald compilé désigne par `images[].uri`
(`/benchmark-assets/emerald-square/textures/*.png`, lues sans jamais être écrites) :
**114 couleur** (baseColor, emissive), **222 données** (normal, metallicRoughness, occlusion).
**591 642 954 o** de PNG ; **4 982 870 028 o** en RGBA8 brut ; **1 245 717 507** texels ;
297 images 2048×2048, 36 en 16×16, 3 en 1×1 ; aucune non-puissance de deux.
Le sidecar v4 du cache y ajoute **4 617 248 o** de niveaux ≤ 64 (`texturePreviewBytes`, 232 entrées).

## Seuil de fidélité appliqué

Règle du dépôt : captures identiques à la référence, ou écart au niveau du bruit A/A. Le bruit A/A
mesuré vaut **0 à 43 pixels sur 12 460 000** (dix captures 1246×1000, journal du 15 sept.).
Seuil retenu : **part de texels dont un canal s'écarte de plus de 1 ≤ 43 / 12 460 000 = 3,45 × 10⁻⁶**.
C'est la lecture la plus généreuse possible : elle compte un texel comme un pixel, alors qu'un texel
faux se voit sur tous les pixels de la surface qui le lit.

## Sans perte — corpus entier, 336 images

L'écart de chaque ligne est **mesuré** par aller-retour, pas déduit du nom du codec.

| candidat | octets | × PNG | max canal | part texels > 1 | verdict |
|---|---|---|---|---|---|
| (a) PNG source | 591 642 954 | 1,000 | référence | référence | reste |
| (a) RGBA8 brut | 4 982 870 028 | 8,422 | 0 | 0 | — |
| (a) PNG réencodé au meilleur effort | 641 763 190 | 1,085 | — | — | rejeté, pire |
| (b) Zstd 3 sur brut | 706 273 753 | 1,194 | 0 | 0 | rejeté, pire |
| (b) Zstd 9 sur brut | 587 371 247 | 0,993 | 0 | 0 | rejeté, −0,7 % |
| **(b) Zstd 19 sur brut** | **478 905 686** | **0,809** | **0** | **0** | **passe l'étape 1** |
| (b) Paeth puis Zstd 9 | 605 369 433 | 1,023 | 0 | 0 | rejeté, pire |
| (b) Paeth puis Zstd 19 | 519 152 712 | 0,877 | 0 | 0 | rejeté, −12,3 % |
| (b) Zstd 19 sur le PNG | 589 249 779 | 0,996 | — | — | rejeté, −0,4 % |
| (d) BC7 ISPC basic | 1 245 717 552 | 2,106 | 97 | 6,03 % | rejeté, fidélité |
| (d) BC7 basic + Zstd 19 | 334 164 900 | 0,565 | 97 | 6,03 % | rejeté, fidélité |

Zstd 19 par genre : couleur 224 605 645 → **136 707 113** (0,609) ; données 367 037 309 →
**342 198 573** (0,932). Gain total **112 737 268 o, −19,1 %**.

Temps CPU cumulés sur le corpus : décodage PNG **12 808 ms**, décodage Zstd 19 **5 608 ms**
(donc le sans-perte décode **deux fois plus vite** que le PNG), encodage Zstd 19 **2 041 866 ms**
(hors ligne, une fois par cache), encodage BC7 basic **3 044 525 ms**.

## Avec perte — échantillon d'une image sur seize, 21 images, 45 560 369 o de PNG

Échantillon étiqueté comme tel : 21 images dont 7 couleur, tirées à pas fixe. Chaque ligne est un
aller-retour complet — encodage, transcodage vers le format que le GPU échantillonnerait, décodage
des blocs, comparaison texel à texel. Basis à qualité 75, effort 2 ; BC7 lent = `alpha_slow` /
`opaque_slow` d'ISPC.

| candidat | octets | × PNG | max canal | moy abs | PSNR dB | > 1 | > 4 | > 16 |
|---|---|---|---|---|---|---|---|---|
| (c) UASTC 4×4 → BC7 | 20 965 811 | 0,460 | 102 | 0,612 | 43,6 | 28,81 % | 9,28 % | 0,312 % |
| (c) UASTC 4×4 → ASTC 4×4 | 20 965 811 | 0,460 | 102 | 0,525 | 43,7 | 27,76 % | 9,06 % | 0,309 % |
| (d) ASTC LDR 4×4 préparé | 83 890 368 | 1,841 | 93 | 0,137 | 51,0 | 6,79 % | 1,07 % | 0,074 % |
| (d) BC7 ISPC lent | 83 886 336 | 1,841 | 58 | 0,137 | 52,2 | 6,74 % | 0,78 % | 0,039 % |
| (d) BC7 lent + Zstd 19 | 26 687 605 | 0,586 | 58 | 0,137 | 52,2 | 6,74 % | 0,78 % | 0,039 % |
| (e) XUASTC LDR 4×4 → BC7 | 19 797 582 | 0,435 | 104 | 0,775 | 41,9 | 32,60 % | 10,05 % | 0,662 % |
| (e) XUASTC LDR 4×4 → ASTC 4×4 | 19 797 582 | 0,435 | 93 | 0,601 | 42,5 | 28,83 % | 9,09 % | 0,579 % |
| (e) XUBC7 → BC7 | 18 193 694 | 0,399 | 94 | 0,808 | 41,3 | 31,19 % | 11,07 % | 0,821 % |

Le meilleur des candidats avec perte pour la fidélité — BC7 au réglage le plus lent — laisse
**6,74 %** des texels à plus d'un niveau d'écart, soit **19 500 fois** le seuil, avec des pointes à
**58 niveaux** sur un canal. Le meilleur pour les octets — XUBC7, −60,1 % — en laisse **31,19 %**.
Aucun ne s'en approche : trois à cinq ordres de grandeur au-dessus du bruit A/A.

Par genre, l'écart se concentre sur les **données** : BC7 lent laisse 1,02 % des texels couleur et
**9,82 %** des texels de données au-dessus du seuil. C'est attendu — normales et rugosité ne
supportent pas une décorrélation pensée pour la couleur — et c'est rédhibitoire : le dépôt ne
sépare pas les règles selon le genre de texture.

## Transport, mesuré dans le Chrome du banc

HeadlessChrome/152.0.0.0, canal `chrome` de Playwright du Lab.

| question | réponse mesurée |
|---|---|
| `DecompressionStream('gzip' / 'deflate' / 'deflate-raw')` | oui |
| `DecompressionStream('zstd' / 'br' / 'brotli')` | **non** |
| `Accept-Encoding` envoyé par Chrome | `gzip, deflate, br, zstd` |
| corps servi en `Content-Encoding: zstd` | **décodé nativement** : 1 048 576 o récupérés exacts depuis 363 o sur le fil |

Donc le gain Zstd est atteignable **sans dépendance WASM**, mais **par le transport seulement** :
c'est le serveur de l'hôte qui pose l'en-tête, pas le SDK qui décompresse.
