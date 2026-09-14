# Plan « première image » — étape 3 de la feuille de route

Plan chiffré, lecture seule. Toutes les valeurs sont **lues** : code de `develop` (`0195ca8`), cache Emerald compilé
sur disque (`render-tech-lab/public/benchmark-assets/emerald-square-derived/native/`), manifeste binaire décodé
colonne par colonne. Aucune mesure navigateur ici : tout ce qui relève du temps est marqué **à mesurer**. Cibles :
première image complète aux niveaux grossiers < 300 ms à froid comme à chaud sur réseau local, `source.bin` hors du
chemin de chargement, textures par mip et par visibilité, remplissage après saut ≤ 0,3 s, captures PNG identiques
(0 pixel) ou différence bornée, expliquée, avec témoin A/A.

## 1. La première image aujourd'hui — chiffres

Chaîne de dépendance réelle (`sdk-browser/manifestLoad.ts:37,42,52` puis `index.ts:204`) : **5 aller-retours
strictement chaînés** — `manifest.json` → `clusters.json` → `clusters.bin` → `source.gltf` → (`source.bin` ∥ 336 images),
puis un 6ᵉ niveau pour les paquets d'amorçage.

| Poste | Octets | Requêtes | Source |
|---|---|---|---|
| `manifest.json` (pointeur) | 236 o | 1 | disque |
| `clusters.json` | 387 061 o | 1 | disque |
| `clusters.bin` (entier, jamais par plage) | **17 031 112 o** | 1 | disque |
| `source.gltf` | 594 159 o | 1 | disque |
| **`source.bin` (entier)** | **195 404 028 o** | 1 | disque |
| **336 textures PNG** | **591,6 Mo** | **336** | disque |
| paquets d'amorçage partagés (indices seuls) | 1,15 Mo | 4 | digests × disque |
| **Total avant la première image** | **≈ 806 Mo** | **≈ 345** | — |

Faits de code qui expliquent ces 806 Mo :

- `index.ts:204` — un seul `await GLTFLoader.loadAsync(source.gltf)` sérialise `source.bin` **et les 336 textures**
  devant la détection WebGL (`:230`), la demande de device WebGPU (`:232`), la création du renderer (`:235`),
  le streamer (`:225`) et donc devant la moindre requête de couverture racine — alors que cette couverture ne dépend
  que du manifeste, déjà en mémoire depuis `:190`.
- `source.bin` n'est **pas** un repli : `pageSelection.ts:167` fait partager aux pages les attributs de la
  `BufferGeometry` glTF, et `webgpuPages.ts:1330-1343` recopie sommet par sommet (`getX/getY/getZ`) tout
  `source.bin` dans trois `Float32Array`, sur le thread principal, dans `prepare()`. Les pages `.bin` d'index ne
  portent que des indices.
- Le mode autonome existe mais reste de second rang : `autonomousGeometry===true` est un **drapeau appelant**
  (`index.ts:194`), il désactive WebGPU (`index.ts:231`) et refuse BLEND (`autonomousPages.ts:71`).
- Côté compilateur, la porte est **une seule ligne** : `lib.rs:671` n'écrit `scene.gltf` que si
  `primitives.iter().all(|p| p["pass"]=="exact-clusters")`. Emerald a 252 primitives `exact-clusters`
  et **29 `clustered-blend`** (`alphaMode:"BLEND"`, 1 732 416 triangles, 28 868 pages) : 29 primitives sur 281
  annulent le bénéfice pour les 252 autres. Et **aucune primitive `shared-blend`** — `source.gltf` ne déclare aucune
  extension de matériau, donc pas de `KHR_materials_transmission` : le blocage n'est pas le verre physique, c'est
  cette garde conservatrice.
- Les pages de géométrie **existent déjà sur disque pour Emerald**, verre compris : 39 742 digests distincts,
  **258,3 Mo**. Rien n'est à recalculer pour les avoir ; elles ne sont simplement jamais lues.
- Aucun `Worker` dans `packages/` (0 occurrence) : décodage meshopt et parcours scalaire par sommet
  (`geometryPage.ts:28-33`) sur le thread principal. Et `manifestBinary.ts:263-299` re-matérialise en objets JS ce que
  le format colonnaire évitait (un `min`, un `max`, une `sphere`, une `parentSphere` **par page**, 44 689 fois).

## 2. Sommets dans les pages — verdict

### Format actuel (`geometry_page.rs`, 55 lignes)

En-tête 32 o (`WGP2`, version 2, nbSommets, nbIndices, flags, STRIDE, octets indices, octets sommets), puis indices
meshopt (locaux, u16) puis sommets meshopt. **STRIDE = 72 o fixe**, table à `lib.rs:499` : position f32×3 (0),
NORMAL f32×3 (12), TEXCOORD_0 f32×2 (24), TANGENT f32×4 (32), TEXCOORD_1 f32×2 (48), COLOR_0 f32×4 (56).
Tout en float32, **sans perte**, aucune quantification nulle part dans le crate. Une page = un cluster
(≤ 128 triangles, ≤ 255 sommets). Sur Emerald, **les 44 689 pages ont toutes `flags == 15`** :
NORMAL + UV0 + TANGENT + UV1, **jamais COLOR_0** — les 16 derniers octets de chaque sommet sont des zéros de
remplissage, soit 7 736 018 × 16 = **123,8 Mo de zéros** dans le flux brut.

### Coût en octets, DAG complet d'Emerald (44 689 clusters, 7 736 018 sommets, 5 403 891 triangles)

| Format | Brut | Encodé meshopt |
|---|---|---|
| f32, stride 72 fixe (**actuel**) | 589,4 Mo | **282,5 Mo** (mesuré sur disque : 258,3 Mo après dédoublonnage) |
| f32, stride utile 56 (sans le créneau COLOR_0) | 465,6 Mo (−21 %) | ≈ 282 Mo (gain ≈ nul : meshopt écrase déjà les octets constants) |
| quantifié pos 3×u16 + oct 2×u16 + UV 2×u16 (22 o) | 202,6 Mo | ≈ 100 à 120 Mo (estimation) |

### Fidélité : l'erreur en pixels

Les boîtes de clusters sont lues dans `clusters.bin`, colonne 0 `pageBounds` (6 × f64, espace objet) :
plus grand axe p50 = 110, p90 = 698, p99 = 2 228, max = 8 087 unités monde ; scène 13 319 × 11 074 × 14 384.
L'échelle est centimétrique (le parcours du Lab pose `eye = max(block·0,008 ; …) = 115` unités, soit une hauteur d'œil
de 1,15 m ; `fov 55°`, `near = radius/10000 = 1,13` unité — `modelCampaign.ts:19-27`).

Quantifier les positions sur 16 bits dans la boîte du cluster donne un demi-pas `étendue / 131 070`.
La borne qui compte est **indépendante de l'échelle et de la distance** : à 1280×720,

> **erreur en pixels = (étendue de la boîte du cluster projetée à l'écran, en pixels) / 131 070**

| Boîte couvrant | Déplacement |
|---|---|
| 100 px | 0,0008 px |
| 720 px (hauteur écran) | 0,0055 px |
| 1 469 px (diagonale écran) | 0,0112 px |
| 5 876 px (4× la largeur) | 0,0448 px |

Second angle, par rapport à l'erreur que le moteur **accepte déjà** (colonne 3 `pageError`, `lodError` certifié) :
le rapport demi-pas / `lodError` vaut p50 = 0,0001–0,0005 et p99 = 0,0009–0,03 à tous les niveaux ≥ 1 — la
quantification ajouterait donc **au pire 3 % du budget d'erreur déjà consenti** (0,03 px à `pixelError = 1`),
typiquement 0,05 %. En revanche **les 21 240 clusters de niveau 0 ont `lodError` exactement 0** : c'est la géométrie
exacte, et les quantifier introduit une erreur là où il n'y en a aucune.

### Verdict — **exact obligatoire pour l'étape 3.** Deux raisons, dans cet ordre :

1. La porte est « 0 pixel ». Un déplacement sous-pixellaire, même de 0,01 px, retourne des pixels de bord :
   quantification et « 0 pixel » sont incompatibles par construction. Aucun chiffre ne peut les réconcilier.
2. Le gain n'est pas là où se joue la cible. L'amorçage exact coûte **13,00 Mo** (valeur lue : 2 317 digests de pages
   racines présents sur disque) ; quantifié il coûterait ≈ 6 Mo. Sept mégaoctets gagnés, contre **195,4 Mo**
   (`source.bin`) et **591,6 Mo** (textures) à retirer. Deux ordres de grandeur d'écart : la quantification ne décide
   pas les 300 ms, elle ajoute un risque de fidélité pour un gain marginal.

**Format retenu : la page autonome actuelle, inchangée, float32 sans perte.** Coût total pour Emerald : **282,5 Mo**
pour le DAG complet (258,3 Mo réels après dédoublonnage), dont **13,00 Mo** pour l'amorçage. Une seule évolution du
format est retenue, sans coût de fidélité : **stride variable** (n'écrire que les attributs présents, 56 o au lieu
de 72 sur Emerald) — gain nul sur le fil, **−21 % sur le décodage et la mémoire**.

**Réserve chiffrée pour plus tard** (étape 5 ou R&D, pas ici) : si une mesure montre que l'amorçage exact ne tient pas
les 300 ms et que le poste dominant est bien les octets ou le décodage des pages racines, alors quantifier **les niveaux
≥ 1 seulement**, niveau 0 bit-exact. Budget d'erreur : ≤ 0,03 px à `pixelError = 1`, image au repos en gros plan
strictement identique (elle n'utilise que le niveau 0). Gain : 172,7 → ≈ 60 Mo.

## 3. Textures — verdict

### Inventaire réel du cache Emerald (lu)

336 fichiers, **tous PNG, aucun mip**, 591,6 Mo sur disque (564 Mio) : 297 en 2048×2048 (189 RGBA, 108 RGB),
36 en 16×16, 3 en 1×1. `source.gltf` déclare 336 `images`, 672 `textures`, 220 `materials` (191 OPAQUE, 29 BLEND),
159 meshes, 1 035 nœuds. Les 336 images sont **toutes référencées** : 111 baseColor + 111 normales + 111 ORM (servant
à la fois `metallicRoughness` et `occlusion`) + 3 émissives. Le compilateur ne touche **jamais aux pixels** :
`rewrite_images` (`lib.rs:121-136`) ne réécrit que des URI ; `Cargo.toml` n'a ni `ktx2`, ni `basis-universal`, ni `image`.
Poids décodé, calculé sur les en-têtes IHDR : **4 983 Mo en RGBA8 (mip 0)**, **6 644 Mo avec la pyramide complète**,
pour 1,246 Gtexel. Le chiffre de « ~866 Mo décodés » du brief est **faux d'un facteur 5,8** et doit être retiré des
documents. Les PNG actuels pèsent 0,475 o/texel (3,8 bits/texel) : ils sont déjà très compressés.

Ce que le runtime téléverse, et quand :

- **Tout est fetché et décodé avant la première image**, sur tous les chemins (`index.ts:204` ; `GLTFLoader` bascule sur
  `ImageBitmapLoader`, donc le décodage est hors thread principal mais l'attente est sérialisée).
  Mips générés **sur GPU** après upload (`textureMips.ts`), jamais lus depuis le disque.
- WebGL : aucune gestion, aucun budget, upload implicite par Three au premier dessin.
- WebGPU : admission progressive réelle (`webgpuPages.ts:412-428`), budget `maxTextureTransferBytesPerFrame` 16 Mio.
  Mais deux tableaux `2d-array` sont alloués **à la dimension maximale, pour chaque couche**
  (`webgpuPages.ts:1356,1382`, `mipLevelCount = 12`) : 2048×2048×4×4/3 = **22,4 Mo par couche**, y compris pour une
  texture 16×16. À 114 couches couleur et jusqu'à 333 couches données, cela fait **≈ 10 Go alloués** pour ≈ 60 Mo
  réellement échantillonnés à 1280×720 — **à confirmer par une mesure VRAM**, c'est un calcul de lecture de code.
  Une couche = 16,78 Mo = le budget d'une image entière : d'où les 336 images d'upload que le chantier 2a a dû purger.

### Signal de visibilité disponible

Il n'existe pas (`materialId`, `materialIndex`, `visibleMaterials` : 0 résultat dans `packages/`), **mais toutes ses
pièces existent** : `PageRec.material` (`pageSelection.ts:17`), les listes par image `drawn`/`shown`/`desired`
(`webgpuPages.ts:309`), et la table texture → couche `mapLayer`/`dataLayer` (`webgpuPages.ts:410`, remplie `:1346-1349`
via `visMaterial()`). La jointure `drawn → rec.material → visMaterial → mapLayer` donne exactement l'ensemble des
couches visibles. Côté WebGL, pas d'équivalent : matériaux posés par `renderOrder` (`clusterBatches.ts:357`).

### Verdict

**Ni KTX2, ni Basis, ni aucune compression avec pertes pour l'étape 3.** Raison chiffrée : sur le fil, UASTC+Zstd
tourne autour de 1 o/texel, soit **1 245 Mo pour Emerald — deux fois pire que les 591,6 Mo de PNG actuels** ; ETC1S
descend à 0,2–0,5 o/texel, donc comparable aux PNG, au prix d'une perte visible. Le gain réel de KTX2 est en VRAM
(4 983 → 623 Mo) et en CPU (pas de décodage de 1,246 Gtexel) : sujets d'images par seconde et de mémoire, pas de
première image. **À traiter à l'étape 5, pas ici.**

**Format retenu : PNG conservé, pyramide de mips émise par le compilateur, un objet par (image, niveau), adressé par
SHA, streamé par visibilité.** Découpage : les niveaux ≤ 64² de toutes les images regroupés en **un seul objet
d'amorçage** ; un objet par (image, niveau) au-dessus (≈ 1 500 objets pour Emerald).

Gain sur la première image : la queue de pyramide ≤ 64² pèse 6,54 Mo bruts en RGBA8 pour les 336 images,
soit **1,5 à 3 Mo en PNG** — contre 591,6 Mo aujourd'hui, soit **un facteur 200 à 400**, en **1 requête au lieu de 336**.
Coût côté cache : +90 à 200 Mo de mips (au plus un tiers du poids des textures) et ≈ 1 500 objets de plus.
Fidélité, en deux temps explicitement séparés :

- **Le streaming par mip est compatible avec « 0 pixel » au repos** : la porte se juge après convergence, et il suffit
  que chaque mip réellement échantillonné soit résident. Il faut donc un compteur `mipsManquants` exposé et une attente
  de convergence dans `shots.mjs`, au même titre que `trous = 0`.
- **La bascule de la source des mips (GPU → compilateur) change l'image une fois.** Les deux filtres sont des moyennes
  2×2 ; l'écart attendu est ≤ 1 LSB par canal, dû à l'arrondi et au traitement sRGB. Cette bascule est
  **le seul changement d'image accepté du plan** : mesurée pour elle-même, bornée, avec témoin A/A, et consignée.

## 4. Amorçage < 300 ms — par quoi

Ce qu'il faut, et rien d'autre, pour une première image **complète** aux niveaux grossiers :

| Poste | Aujourd'hui | Cible | Valeur lue |
|---|---|---|---|
| pointeur + métadonnées | 387 Ko, 2 requêtes chaînées | 1 requête | — |
| manifeste | 17,03 Mo entier, 1 requête | **tranche d'amorçage ≈ 0,9 Mo** | 2 668 racines × 188 o + structure |
| géométrie des racines | 0 (vient de `source.bin`, 195,4 Mo) | **13,00 Mo, 1 objet** | 2 317 digests sur disque |
| indices des racines | 1,15 Mo, 4 objets | **0** (les pages portent leurs indices locaux) | — |
| textures | 591,6 Mo, 336 requêtes | **1,5 à 3 Mo, 1 objet** | queue ≤ 64² |
| **Total** | **≈ 806 Mo, ≈ 345 requêtes, 5 aller-retours** | **≈ 17 Mo, 4 requêtes, 2 aller-retours** | — |

Budget de temps, à mesurer, pas promis : 17 Mo tiennent en ≈ 136 ms sur un réseau local à 1 Gb/s (125 Mo/s) et en
quelques millisecondes sur boucle locale. Le décodage est le second poste : 34,7 Mo bruts de pages racines, soit
≈ 87 ms de meshopt WASM à 0,4 Go/s — **plus** le parcours scalaire par sommet et par attribut de
`geometryPage.ts:28-33`, non instrumenté, possiblement dominant. D'où trois leviers, dans cet ordre :

1. **Paresse et parallélisme** : la couverture racine ne dépend que du manifeste (`index.ts:190`) ; ne plus l'attendre
   derrière `index.ts:204`. Aligner WebGPU sur WebGL en rendant l'amorçage paresseux (`webgpuPages.ts:1550`
   fait aujourd'hui `await ensureBootstrap()` dans `prepare()`, alors que WebGL le fait au premier `render()`,
   cf. `bootstrapOrder.test.ts:42-48`). Ne préparer que le backend actif (4 sont construits et préparés pour 1 utilisé,
   `index.ts:245-255`).
2. **Un seul paquet d'amorçage** de quelques Mo, au lieu de 2 317 objets de géométrie + 336 textures : la constante
   existe déjà (`BOOTSTRAP_BUNDLE_BYTES = 1 Mio`, `lib.rs:28`) et le mécanisme de concaténation inter-primitives aussi
   (`share_bootstrap_bundles`, `lib.rs:265-323`) — il ne couvre que les indices, il doit couvrir la géométrie.
3. **Décodage hors thread principal** : aucun `Worker` aujourd'hui. C'est la seule voie pour recouvrir décodage et
   transfert, et pour que l'amorçage ne bloque pas la première image.

Soupape de sécurité chiffrée, si la mesure dépasse 300 ms : ne demander que les racines dans le tronc de vue. La tranche
d'amorçage du manifeste porte les boîtes ; un test de frustum ramène ≈ 40 % des racines, soit **5,2 Mo au lieu de
13,00 Mo**, au prix d'un aller-retour de plus. Cohérence avec `RD_CHARGEMENT.md` : ce plan réalise sa piste 6 (pages
autonomes pour le verre) et sa piste 5 revue (mips plutôt que KTX2) ; ses pistes 1 (fichier unique + plages),
2 (compression + Worker) et 3 (cache persistant) restent après l'étape 3, dont le point 3 ci-dessus est le préalable.

## 5. Chantiers d'agents

Règles communes : **un seul chantier mesuré à la fois** ; image identique à chaque fusion (10 poses Emerald + A/A,
témoin même-build) ; **aucune dette** (formats abandonnés supprimés, pas de compatibilité) ; tests une seule fois en fin
de chantier. Mesure avant/après avec `render-tech-lab/scripts/headless/` : `stack.mjs` (chargement et première image),
`shots.mjs` (captures + `triangles` vs `selectedTriangles`), `walk.mjs` (parcours), `pngdiff.mjs`.

**C0 — Instrumenter la première image (Lab seul, 1 j, aucune mesure de performance).**
`stack.mjs` ne rend qu'un `ms` global. Ajouter : vidage du cache HTTP par CDP (`Network.clearBrowserCache`) pour un vrai
« à froid », octets et requêtes par réponse, ventilation manifeste / glTF / textures / amorçage / décodage / première
image. **Porte** : les 806 Mo et 345 requêtes du §1 retrouvés à ± 5 %. Régénération : non.
*Sans C0, aucun chiffre de temps du plan n'est attribuable.*

**C1 — Scène autonome pour les matériaux BLEND (compilateur + runtime, 3 j).**
`lib.rs:671` accepte `clustered-blend` en plus de `exact-clusters` ; `autonomousPages.ts:71` lève l'exclusion BLEND.
L'ordre de composition est déjà porté par `page.start = source_rank*3` (`lib.rs:576`) et rejoué par
`pageSelection.ts:161-165` : rien à inventer. **Porte** : `autonomousScene` non nul pour Emerald, `source.bin` absent
de la trace réseau en mode autonome, 0 pixel sur les 10 poses dont les segments 3 et 4 (transparences, gros plan).
Régénération des 8 caches : **oui** (le manifeste change).

**C2 — Le mode autonome devient le chemin unique (runtime + compilateur, 5 j).**
Supprimer le drapeau `autonomousGeometry` (`index.ts:194`) et la désactivation de WebGPU qui l'accompagne (`:231`) ;
les sommets viennent des pages sur **tous** les backends — donc retirer le partage des attributs glTF
(`pageSelection.ts:167`) et la recopie scalaire de `source.bin` (`webgpuPages.ts:1330-1343`).
Dette supprimée : `source.bin` et `source.gltf` hors du chemin du moteur (conservés, mais demandés explicitement par
les moteurs de comparaison du Lab, qui sont des instruments de mesure et non un repli) ; `scene.gltf`/`scene.bin` et
leur triangle factice supprimés ; **les 39 734 objets d'index (57,8 Mo) et les 777 paquets (58,2 Mo) supprimés**, les
pages portant déjà leurs indices locaux — cache Emerald 377,6 → 258,3 Mo, 80 343 → 39 742 objets.
**Porte** : 0 pixel sur les deux backends, `source.bin` jamais requis, compteurs `tri = selected` inchangés.
Régénération : **oui**. *Mesurer ici le remplissage après saut : voir R2.*

**C3 — Textures par mip et par visibilité (compilateur + runtime, 9 j — le plus gros).**
Compilateur : lire les PNG, produire la pyramide, écrire un objet par (image, niveau) + un objet de queue ≤ 64²,
adressage SHA, colonnes dans `clusters.bin` (ou un fichier `textures.bin` à côté).
Runtime : assembler le signal de visibilité (`drawn → rec.material → visMaterial → mapLayer`), déduire le mip requis
de la taille projetée du cluster, file priorisée, compteur `mipsManquants`, tableaux dimensionnés par classe de taille
au lieu de 2048² pour tout le monde. Retirer la génération GPU des mips (`textureMips.ts`).
**Porte** : la bascule de source des mips est mesurée **seule**, avec témoin A/A et borne consignée (attendu ≤ 1 LSB
par canal) ; ensuite 0 pixel et `mipsManquants = 0` avant capture. Régénération : **oui**.

**C4 — Amorçage : un paquet, paresseux, décodage hors thread (runtime + compilateur, 4 j).**
Paresse et parallélisme du §4 point 1 ; extension de `share_bootstrap_bundles` à la géométrie pour un objet
d'amorçage unique ; décodage meshopt et parcours d'attributs dans un `Worker` (premier `Worker` du paquet).
**Porte** : **première image < 300 ms à froid et à chaud** mesurée par `stack.mjs` outillé en C0, 0 pixel.
Régénération : **oui** (nouvel objet d'amorçage).

**C5 — Manifeste dégraissé et tranche d'amorçage (compilateur + `sdk-core`, 3 j).**
Colonnes f64 → f32 (0, 1, 2, 3, 9, 11, 12) avec arrondi des bornes **vers l'extérieur**, digests 64 o hexa → 32 o bruts
(6, 7, 19) : **17,03 → ≈ 10,0 Mo**. Tranche d'amorçage (racines seules, ≈ 0,9 Mo) servie d'abord, reste en arrière-plan.
Décodage sans rematérialisation d'objets JS (`manifestBinary.ts:263-299`). **Porte** : coupe identique
(`selected` et `tri` inchangés) et 0 pixel — sinon revenir en f64 pour les seules bornes. Régénération : **oui**.

**C6 — Stride variable des pages (compilateur + runtime, 2 j, optionnel).** N'écrire que les attributs présents
(56 o au lieu de 72 sur Emerald) ; `geometryPage.ts:18` impose aujourd'hui `stride === 72`. Gain : **−21 % de décodage
et de mémoire**, nul sur le fil. **Porte** : 0 pixel, décodage mesuré. Régénération : **oui**.

Ordre : **C0 → C1 → C2 → C3 → C4 → C5 → (C6)**. Total ≈ **27 jours**. Régénération des 8 caches à la fin de C1 à C6 —
regrouper les régénérations quand deux chantiers se suivent sans mesure intermédiaire.

## 6. Risques et inconnues, et la mesure qui les lève

**R1 — Les 2 s ne sont attribuées à rien.** Personne n'a mesuré la part transfert / décodage / upload / premier rendu ;
tous les gains de ce plan restent des estimations. *Mesure : C0, en premier, avant tout code.*

**R2 — Retirer `source.bin` déplace le coût du chargement vers le remplissage après saut.** Aujourd'hui les 88 ms de
remplissage au pire sont obtenus avec **tous** les sommets déjà en RAM. Après C2, un saut vers une zone jamais visitée
doit chercher la géométrie : à 4 096 pages résidentes, ≈ **25,9 Mo** (4 096 × 6,3 Ko encodés), soit ≈ 207 ms à 125 Mo/s
— la cible de 0,3 s tient tout juste ; sans plafond de résidence (32 768 pages, `index.ts:223`) c'est ≈ **97 Mo** et la
cible est manquée. *Mesure : `walk.mjs` segment 7 (« déplacement rapide et chargement ») et segment 9 (« retour vers
une zone visitée »), à froid, à `MAX_PAGES` 4 096 puis sans plafond, avant et après C2. C'est le premier risque à lever
après C0 : il peut imposer le plafond de résidence comme réglage de production.*

**R3 — La bascule de source des mips n'est pas garantie sous le LSB.** Le filtre GPU de `textureMips.ts` gère l'espace
colorimétrique déclaré et borne l'échantillonnage à l'image et non à la couche paddée : reproduire cela exactement en
Rust n'est pas acquis. *Mesure : test unitaire comparant niveau par niveau la pyramide du compilateur à la sortie du
nuanceur sur 3 textures Emerald réelles (une RGB, une RGBA, une normale), puis diff PNG 10 poses avec témoin A/A.
Si l'écart dépasse 1 LSB par canal, C3 devient un changement d'image borné à documenter, pas un chantier « 0 pixel ».*

**R4 — Les ≈ 10 Go de tableaux de textures WebGPU sont un calcul, pas une mesure.** S'ils sont réels, ils expliquent
peut-être une part des temps WebGPU et la cible de 300 ms serait hors d'atteinte sur ce chemin avant C3.
*Mesure : compteur d'octets alloués par `createTexture` exposé dans les métriques, sur Emerald, avant C3.*

**R5 — L'ordre de composition des transparents après C1.** Les 29 primitives BLEND représentent 64 % des triangles
d'Emerald ; l'ordre est porté par `start`, mais l'ordre **entre** pages autonomes doit être rejoué à l'identique.
*Mesure : diff PNG des segments 3 et 4 du parcours, verre dans le cadre, témoin même-build.*

**R6 — La tranche d'amorçage du manifeste et les bornes en f32 peuvent déplacer la coupe de LOD.** Un cluster qui
bascule de niveau change des pixels sans que rien ne soit « cassé ». *Mesure : comparer `selectedTriangles` et
`triangles` pose par pose, avec bornes arrondies vers l'extérieur ; revenir en f64 pour les bornes si la coupe bouge.*
**Inconnue à lever avant C3** : combien de mips une pose réelle échantillonne vraiment — l'estimation du §3
(≈ 60 Mo résidents à 1280×720) est un raisonnement de budget d'écran, pas une mesure.
*Mesure : compteur de couches et de niveaux réellement échantillonnés par image, sur les 10 poses.*
