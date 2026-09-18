# Spécification — WebGeometry sans Three.js : moteur, éditeur, cuisson finale

Version 2, 16 septembre 2026. Document de référence pour les agents. Chaque exigence est numérotée et vérifiable ; une exigence sans mesure associée n'existe pas.

## 0. Objectif et non-objectifs

Objectif : un moteur de géométrie virtualisée complet et autonome pour le web, utilisable dans un éditeur (mode édition) et livrable dans un jeu (mode final), à 120 images par seconde sur les scènes du banc, sans perte de rendu, sans dépendance à Three.js dans le SDK ni dans le runtime livré. Three.js ne subsiste que dans le banc de mesure, comme moteur témoin.

Non-objectifs de cette version : animation squelettique, physique, audio, réseau, éclairage global dynamique, ombres. Ils sont hors périmètre et ne doivent pas être commencés avant la fin des phases 1 à 5.

Règles transverses : fidélité avant vitesse (aucune réduction de résolution, de distance, de qualité ; transparents jamais transformés en masqués) ; aucune dette ; mots interdits (nom du système de géométrie virtualisée d'Epic, nom de son moteur) ; un hôte ne configure rien et ne lit aucun champ de format ; tests écrits après le code, une passe ; chaque fusion prouvée par captures identiques ou différence expliquée au niveau du bruit A/A.

## 1. Architecture cible

```
Sources (glTF, FBX, OBJ, STL, PLY, images)
        │
        ▼
[1] Compilateur natif Rust (binaire unique, multi-OS, aussi en wasm pour l'éditeur)
    import → normalisation → clusters 128 tri → DAG par objet (multi-matériaux)
    → erreur certifiée (forme + couleur + quantification) → paquets autonomes
    → textures en mips streamables → manifeste binaire → cache par objet, adressé par empreinte
        │                                   ▲
        ▼                                   │ recompilation d'un objet (mode édition)
[2] Format de cache versionné (dossier statique, tout en .bin + un petit JSON)
        │
        ▼
[3] Runtime navigateur (TypeScript + WGSL + GLSL, zéro Three.js)
    chargeur → streaming prioritaire → sélection de clusters (GPU en WebGPU, CPU en WebGL2)
    → rendu (visibility buffer + éclairage différé en WebGPU ; multi-draw + forward en WebGL2)
    → API scène (ajouter, retirer, transformer, matériaux, caméra, picking)
        │
        ├── [4] Éditeur (mode édition : compilation incrémentale, échange à chaud, mode source, historique)
        └── [5] Cuisson finale (mode final : recompilation globale, blocs de quartier, ordre de streaming, runtime seul)

[6] Banc : Three.js témoin, campagnes 4 moteurs, parité WebGPU/WebGL2, captures, rapports
```

## 2. Compilateur natif (Rust)

C1. **Import** : glTF/GLB natif ; FBX et OBJ via `ufbx` ; STL et PLY. Sortie normalisée : positions, normales, UV (deux jeux), couleurs, tangentes si présentes, matériaux PBR (couleur, métal-rugosité, normale, émission, occlusion, alpha mode), hiérarchie et matrices, instances. Critère : les huit scènes du banc et trois fichiers FBX/OBJ de test importés sans Blender ni Node.
C2. **Clusters** : partition spatiale en clusters de ≤ 128 triangles, compacts, bornes sphère et boîte. Critère : distribution des tailles publiée, aucune boîte dégénérée.
C3. **DAG par objet, multi-matériaux** : construit sur toutes les primitives opaques d'un maillage ; groupes de 8 à 32 clusters ; simplification par groupe avec verrous par sommet aux frontières de groupes ; chaque triangle garde son matériau ; pages publiant des plages par matériau. Frontières de matériaux verrouillées tant qu'elles représentent plus d'un pixel à la distance de bascule du niveau, libres au-delà. Transparents : DAG propre par primitive, ordre source conservé. Critère : Emerald vue générale ≤ 200 000 triangles sélectionnés à 1 px pour une ville, image identique à 0 px, différences à 1 px localisées et sous le seuil.
C4. **Erreur certifiée** : `error(cluster) = max(erreur géométrique du groupe, erreurs des enfants) + erreur de quantification + erreur de couleur` (déviation UV et normale pondérée par la texture), monotone, en unités objet, avec sphère de projection. Critère : test de monotonie sur toutes les scènes, aucune violation.
C5. **Paquets autonomes** : chaque paquet (~64 à 128 Ko) contient index, positions quantifiées (16 bits par axe sur la boîte du cluster), normales octaédriques 16 bits, UV 16 bits, couleurs 8 bits, plages de matériaux ; encodé meshopt ; `source.bin` n'est plus lu par le runtime. Critère : octets par triangle ≤ 12 ; remplissage de la vue générale d'Emerald < 300 ms à chaud.
C6. **Textures** : décodage PNG/JPEG dans le compilateur, génération des mips, découpe en tuiles ou en niveaux streamables, table d'atlas ; format GPU brut, sans perte, ou compressé par blocs avec perte (BC/ASTC, voir §7 et Textures T5 ; les seuils 0 px du banc ne s'appliquent pas à ce lot). Critère : première image d'Emerald sans aucune texture pleine résolution ; mips demandés par visibilité.
C7. **Manifeste binaire** : colonnes typées (bornes, sphères, erreurs, niveaux, groupes, plages de matériaux, paquets, offsets), un JSON de quelques centaines de Ko (objets, matériaux, structure), le tout adressé par empreinte SHA-256. Critère : chargement + décodage < 100 ms pour Emerald.
C8. **Cache par objet** : un objet compilé = un dossier adressé par l'empreinte de sa source et des options ; une scène = un manifeste qui référence des objets et des instances. Recompiler un objet ne touche pas les autres. Critère : modifier un objet d'Emerald et recompiler ≤ 500 ms pour un objet de 100 000 triangles.
C9. **Binaire unique** : un exécutable par OS (macOS arm64/x64, Linux x64/arm64, Windows x64), protocole d'événements sur stdout (progression, erreurs, résultat court), résultat écrit sur disque, jamais un manifeste complet sur stdout. Le même code compilé en WebAssembly pour l'éditeur (compilation d'un objet dans le navigateur, hors thread principal). Critère : le Lab prépare ses scènes sans Node autrement que comme relais ; l'éditeur recompile un objet sans serveur.
C10. **Provenance** : empreinte du compilateur (sources + dépendances verrouillées) dans chaque cache ; deux compilations du même fichier donnent les mêmes octets. Critère : diff nul entre deux exécutions.

## 3. Runtime navigateur (TypeScript, WGSL, GLSL)

R1. **Zéro dépendance Three.js** dans `sdk-browser`. Maths propres (matrices, quaternions, frustum, rayons) partagées avec le compilateur via wasm là où la parité compte (erreur d'écran, picking).

R1a. **Ce qui reste de Three.js dans le moteur, mesuré.** Le relevé du 15 septembre (lot T1) recensait fichier par fichier chaque appel à une méthode de calcul de Three.js dans `sdk-browser` ; ses comptes sont périmés et se relisent dans `git log` plutôt que d'être recopiés ici. La règle en vigueur est la liste fermée tenue par `test/integration/moteur-sans-three.test.mjs` et `test/integration/moteur-sans-three-math.test.mjs` : tout fichier du moteur qui importe `three` hors de cette liste fait échouer le test, et la liste ne grandit jamais. Sur le chemin WebGPU par image : coupe de clusters (`pageSelectionCut.ts`), uniformes de sélection (`gpuSelection.ts`), encodage des dessins, du mélange et des ombres (`webgpuPagesEncode*.ts`), sens des faces (`webgpuBlendDraw.ts`), Hi-Z (`hizDepth.ts`, `hizProjection*.ts`, `hizTemporal.ts`) ; la matrice vue-projection y est recomposée neuf fois par des copies indépendantes. Au chargement : boîtes et sphères des pages (quatre copies de `Box3.getBoundingSphere`), matrices monde des nœuds. Le reste ne sert qu'aux moteurs témoins Three (`referenceBackend.ts`, `threeLod.ts` avec `LOD.update`, `exactPages*.ts`) et au diagnostic. Des calculs maison existent déjà et servent de base : `extractPlanes`/`boxClip` (`pageSelectionMath.ts`), transformation des coins d'une boîte (`hizCorners.ts`), `maxStretch`/`clusterErrorPixels` (`projectionOracles.ts`), `shadowProjection`/`shadowOrthographic`/`composeFace` (`sceneLightShadowMath.ts`), et les fonctions communes des lots `formules-communes-*`.

R1b. **Socle mathématique maison, pas un clone de Three.** Un module dans `sdk-core` (sans DOM), limité aux opérations réellement appelées : vecteurs 3 et 4, matrices 3×3 et 4×4 (produit, inverse, déterminant, matrice normale, composition et décomposition TRS, `lookAt`, perspective et orthographique dans l'unique convention de profondeur du moteur — profondeur inversée `[0,1]`, plan lointain infini, domiciliée dans `packages/sdk-browser/depthConvention.ts` et composée par `perspectiveProjection` de `packages/sdk-core/mathCamera.ts`), quaternions, couleurs (HSL, sRGB ↔ linéaire, déjà factorisées). Représentation : `Float64Array`/`Float32Array` colonne-major comme Three, sorties passées en paramètre, zéro allocation par image, opérations par lots (n boîtes, n sphères) plutôt que par objet. Remplacer chaque méthode Three en gardant `THREE.Vector3`, `THREE.Matrix4` ou `Object3D` dans les signatures ne compte pas : la dépendance tombe quand plus aucun type Three ne traverse le moteur.

R1c. **Transformations et caméra possédées par le moteur.** La partie délicate n'est pas la formule mais la hiérarchie : parent/enfant, ordre de mise à jour, marquage sale, échelles négatives et non uniformes (le signe du déterminant décide le sens des faces), matrices singulières, caméra (vue, projection, vue-projection, inverses, plans de frustum) et conventions de profondeur. Ces objets remplacent `updateMatrixWorld`, `getWorld*`, `lookAt`, `updateProjectionMatrix` sur le chemin WebGPU. `LOD.update` appartient au moteur témoin Three : il le suit hors du SDK, il n'est pas réécrit.

R1d. **Preuve, à chaque lot.** Banc d'équivalence contre Three.js sur des cas représentatifs et dégénérés (échelles négatives, non uniformes, matrices singulières, NaN, ±0, infinis) : identité bit à bit là où la formule est la même, sinon écart borné et expliqué avant fusion ; campagne du banc commun à 0 pixel (trois vues fixes et caméra mobile, deux seuils, témoin A/A), `tri = selected`, compteur d'allocations par image nul ; tests de structure (`test/integration/moteur-sans-three.test.mjs`, `test/integration/moteur-sans-three-math.test.mjs`) interdisant `three` dans les fichiers du chemin WebGPU puis dans tout `sdk-browser` hors adaptateur témoin. Un gain de vitesse n'est pas un objectif de ces lots : il se mesure, il ne se suppose pas.

R1e. **Workers et WebAssembly : après mesure, jamais pour une matrice isolée.** Un worker libère le fil de rendu, WebAssembly accélère du code compilé, les deux se combinent (décodage des pages : `pageDecodePool.ts`, `pageDecodeTask.ts`, `geometryPageWasm.ts`, déjà en place). Répartition envisagée, à confirmer au banc sur machine calme : matrices de caméra, vecteurs et couleurs en TypeScript sur le fil de rendu ; transformation de grands ensembles de sommets et calcul de volumes par lots en worker, Wasm si le gain est mesuré ; construction de structures spatiales en worker, Rust/Wasm partagé avec le compilateur là où la parité compte (erreur d'écran, picking) ; sélection de visibilité de l'image courante inchangée tant qu'une autre organisation n'a pas été mesurée. Le nombre de sites d'appel ne mesure pas un coût : fréquence réelle, volume traité et échanges entre fils se mesurent avant tout déplacement. Les tampons transférables évitent des copies mais changent de propriétaire : un lot, pas un appel.

R2. **Chargeur** : lit manifeste binaire et paquets ; jamais un champ de format côté hôte ; validation publique (`assertCachePointer`, `assertCacheReady`).
R3. **Streaming** : 32 transferts en vol, priorité par erreur d'écran puis distance, couronne de préchargement, prédiction de caméra, cache LRU borné en octets, cache persistant par empreinte (Cache Storage/OPFS), transferts en cours jamais annulés par un mouvement. Critère : après un saut de caméra, coupe complète < 300 ms à chaud ; deuxième visite sans réseau.

R3b. **Budget de pages, et ce qu'il garantit.** Le budget se compte en **pages distinctes**, jamais en placements : un slot de cache tient une page, et deux placements d'un même cluster — sous deux instances d'un objet — en occupent un seul. Quand la coupe demandée dépasse le budget, la file garde le préfixe le plus grossier (niveaux décroissants, ordre de publication à niveau égal) ; le cache reprend ses slots par ancienneté quand ils manquent, et ce que l'image dessine est épinglé tant qu'elle le dessine, y compris un ancêtre résident que la coupe n'a pas demandé. Décharger d'autorité toute clé qui sort de l'ensemble gardé a été essayé et mesuré : 211 041 évictions en soixante-dix images, une image plus grossière, à ne pas refaire. Garantie : **l'ensemble résident est fonction de la coupe demandée et du budget seuls**, jamais de l'ordre dans lequel le réseau a livré les pages — deux exécutions de la même caméra au même seuil résident le même ensemble et rendent la même image. Critère : témoin A/A à 0 pixel sur quatre exécutions, chauffe par défaut du harnais.
R4. **Couverture** : racines épinglées, repli par groupe sur la représentation grossière résidente, jamais de trou, jamais d'exception hors racine absente. Critère : `tri = selected` à tout budget ≥ racines.
R5. **Sélection** : WebGPU en compute (un thread par cluster, hiérarchie de culling en rejet précoce, occlusion Hi-Z de l'image précédente) ; WebGL2 sur CPU (hiérarchie de culling, sans allocation) avec option wasm SIMD si > 2 ms. Critère : Emerald sélection < 1 ms GPU, < 2 ms CPU.
R5b. **Invariant du test Hi-Z.** Le test d'occultation ne décide jamais qu'un cluster visible ne sera pas dessiné : il compare un **minorant strict** de la profondeur que le cluster écrira à un **majorant** de la profondeur déjà écrite sur son empreinte. Le majorant est la réduction par maximum de la profondeur de la passe déjà dessinée, lue au mip dont l'empreinte arrondie vers l'extérieur couvre le rectangle écran découpé sur le viewport. Le minorant est le coin le plus proche de la boîte **entière**, corrigé de deux écarts : l'arrondi du transport en simple précision, dirigé vers moins l'infini, et le biais de couche coplanaire, retranché en unités matérielles par `biasedDepthBits` — un cluster de couche non nulle est dessiné plus près que son propre coin. Une boîte qui coupe le plan proche, une empreinte vide ou plus large que le noyau ne rejettent jamais. Conséquence : le test peut retarder un cluster d'une passe, jamais retirer un pixel. Critère : cas construits (arrondi qui monte, couche coplanaire) dans `hizNearestBound.test.ts`, et 0 pixel au banc.

R5c. **Sur un pixel de profondeur exactement égale, le vainqueur dépend de l'historique de visibilité.** Le partage occulteurs/testés décide de l'**ordre** de dessin, et à profondeur égale le test `greater` (`DEPTH_COMPARE`, `packages/sdk-browser/depthConvention.ts`) donne toujours le pixel au premier dessiné. Quatre faits, mesurés au banc et vrais de toute scène par construction. **(a)** Une couche de profondeur est portée par `pageDepthLayer`, une valeur **par page de primitive** : elle ne sépare ni deux triangles d'un même cluster, ni deux instances d'une même page — 57 à 77 % des égalités d'une scène réelle. **(b)** 100 % des pixels qu'un changement de partition déplace opposent **deux clusters distincts**. **(c)** Mais ces clusters ne sont pas coplanaires : lus sur l'image d'identité de cluster, ce sont des pixels de **frontière** — le perdant occupe un pixel voisin de l'image de référence, aucun voisinage n'est uniforme — sur une **arête que deux surfaces non coplanaires partagent**. La relation en jeu est « deux clusters partagent une arête » : massive, portée par la vue, hors des quatre bits de couche. Aucune extension de `coplanar-depth-layers-*` ne peut donc fixer ce vainqueur, et le vainqueur fixé à la compilation est **abandonné**. **(d)** Contrat : sur un pixel où deux clusters ont exactement la même profondeur, le vainqueur dépend de l'historique de visibilité ; la borne est l'**ensemble d'égalité exacte**, ≤ 0,007 % de l'image sur la scène du banc. Preuve exigée d'un changement de partition : tout pixel déplacé appartient à l'ensemble d'égalité exacte mesuré par un instrument qui remplace `DEPTH_COMPARE` par `depthCompare: 'greater-equal'` (instrument à écrire : rien de tel n'existe aujourd'hui dans `packages/sdk-browser`) ; son compte par vue ne dépasse pas celui de la passe unique ; l'image ne scintille pas d'une image à l'autre à caméra fixe ; la caméra mobile aux deux seuils ne sort pas de l'ensemble d'égalité ; trous 0 et coupe identique.

R5d. **Ce que la coupe ne relit pas par cluster : la racine le déclare une fois.** Le chemin par cluster de la coupe (`take`, `keep`) est parcouru quatre-vingt mille fois par image en vue générale : tout ce qui y est constant sous un nœud est posé une fois par racine ou par coupe, puis passé en paramètre — jamais relu sur l'état ni sur la fiche. Deux déclarations en découlent. **Les cônes** : `ClusterRoot.cones` vaut `false` quand aucune page de la racine ne porte de cône de normales, et la coupe cesse alors de lire `cone` ; absent ou `true`, elle teste chaque page. Le silence garde donc le comportement complet, et **qui pose un cône sur une page relève le drapeau de sa racine** — `collectClusterPages` déclare `false`, `prepareCones` relève `true`. C'est le seul contrat qui rende une omission visible : une racine qui porte des cônes sans les déclarer les perdrait sans bruit. **La résidence** : la règle (`RESIDENT_ALL`, `RESIDENT_ASK`, `RESIDENT_ARRAY`) ne dépend que de la demande de coupe et se résout une fois dans `selectVisiblePages`. Critère : coupe identique bit à bit, `selectedTriangles` égaux, 0 pixel à caméra fixe et mobile aux deux seuils.

R5e. **Ce que la hiérarchie de culling a déjà réglé : le tronc.** Mesuré sur la scène du banc, hiérarchie comprise, vue générale au seuil nul : 80 153 clusters visités, **tous sous un nœud entièrement dans le tronc**, et **2 479 appels au test de boîte en tout — un par racine, aucun sur un nœud interne, aucun sur une page**. Profil V8 de la coupe : `traverse` 36,4 %, `keep` 20,1 %, `take` 11,0 %, **test de boîte 3,2 %**. Le « deux tiers du temps dans le test de tronc » du lot précédent était l'artefact d'un profil pris **sans** hiérarchie, où chaque page paie son test ; avec elle, le tronc est déjà résolu au premier nœud de chaque racine. Conséquence de contrat : la seule lecture de fiche que le tronc imposait encore à un cluster qu'il ne teste pas est la **présence** de sa boîte, et `ClusterRoot.boxes` la retire — `true` déclare que chaque page de la racine porte `min` et `max`, absent ou `false` fait vérifier chaque page comme avant, et `collectClusterPages` déclare `true` parce que le contrat de page rend les deux obligatoires. Critère : coupe identique, `selectedTriangles`, `nodesTested` et `frustumRejected` égaux, 0 pixel à caméra fixe et mobile aux deux seuils. Deuxième conséquence, sur les listes : les deux coupes n'étaient pas coûteuses à cause de `push` mais parce que `length = 0` **rend leur capacité à chaque image** et qu'elles la repoussent de zéro à quatre-vingt mille — les listes sont donc écrites par indice et ne prennent leur longueur qu'une fois la coupe finie, les comptes de l'état faisant foi pendant. Ce qui reste pour la cible de 2 ms n'est plus le tronc mais la fiche elle-même : la boucle de pages de `traverse`, le dispatch par cluster, et le coût par racine (2 479 tests de boîte monde, deux produits de matrices et une extraction de plans).

R6. **Rendu WebGPU** : visibility buffer, compaction et `drawIndexedIndirect` par cluster, raster logiciel borné aux petits triangles réels, résolution matériau par binning, éclairage différé (GGX, IBL si et quand livré, tone mapping ACES, sRGB), transparents en sélection GPU et indirect par matériau, table de pages statique mise à jour par page, zéro allocation par image. Critère : Emerald 1280×720 CPU < 4 ms, GPU < 6 ms, image identique à la référence.

R6b. **Ce que le processeur fixe coûte encore, et où il est passé.** Le coût processeur fixe d'une
image WebGPU (Emerald, vue générale, seuil 0, 1280×720) vaut **4,7 à 4,9 ms** après le lot
`blend-encodage`, contre 6,1 à 6,2 ms sur sa base dans la même exécution, 7,7 le 15 au soir et
33,6 ms le 14 septembre. **À caméra mobile le lot ne rend rien** — 8,7 → 8,5 ms au seuil 0, dans le
bruit : toutes les bornes projetées changent à chaque image, donc aucune boîte n'est tenue. Le profil
par étape, mesuré borne par borne et non déduit d'un compteur voisin, donne les postes restants dans
l'ordre : **fiches de dessin ~1,3 ms** ; **adoption de la coupe 0,9 ms** ;
**transparents 0,8 ms** (monde 0,2 · uniformes de mélange 0,4 · encodage des 1 928 appels 0,2) ;
**test Hi-Z ~0,4 ms** (la comparaison des boîtes tenues, à caméra fixe) ; **animations 0,4 ms** ; **boucle
d'historique des occulteurs 0,4 ms** ; **partition 0,4 ms** ; **téléversements 0,2 ms**.

Deux erreurs de lecture sont corrigées ici. **L'encodage de la passe de mélange ne coûte pas 2,7 à
3,1 ms mais 0,2** : le compteur `appelsDeMelange` s'affiche sur la ligne « Encodage des passes », la
durée du mélange non — `transparentEncodeMs` se dépose sur « Transparents » et `encodeRestMs` la
retranche. Les 2,7 ms étaient **l'empaquetage des boîtes testées du Hi-Z**, 1,7 ms pour
trente-six mille boîtes et 1,18 Mo par image, plus 0,4 ms de boucle d'historique des occulteurs. Et
**la lecture par objet des fiches ne demandait aucun invariant nouveau** : la ligne du tableau de
pages porte déjà le compte d'indices que la carte dessine, écrit par la même fonction qui pose la
ligne ; le lire est plus exact que de relire l'objet, pas moins.

Ce qui reste refusé, et la raison compte : mettre `uncoveredTriangles` en cache rendrait la preuve
d'absence de trou dépendante de l'exactitude d'une estampille ; tenir le **résultat entier** des
fiches d'une image à l'autre demande toujours l'invariant non établi sur la durée de vie du tableau
d'une page résidente ; et porter la projection du test Hi-Z sur la carte est impossible au bit près,
`projectCornersInto` projetant en double précision et `hizNearestBound` tirant sa démonstration de
minorant de cette précision, que WGSL n'a pas.

R6c. **Ce qu'un lecteur garde d'une image à l'autre porte l'âge de ce qu'il décrit.** Toute liste,
tout compte, toute borne tenue d'une image sur l'autre doit être validée par une estampille de la
donnée décrite, jamais par un drapeau posé pendant le rendu : l'adoption de la coupe se produit aussi
**hors** du rendu — la vidange en rejoue une après que l'hôte a pris ses listes —, et un drapeau par
image ne voit pas ce qui bouge après lui. Coût de l'oubli, mesuré : 5 918 pixels et une coupe de
1 273 565 triangles au lieu de 1 599 951, invisibles à caméra fixe. Critère : **toute optimisation de
listes, de résidence ou d'épinglage se prouve en caméra mobile**, aux deux seuils, en plus des poses
fixes.
R7. **Rendu WebGL2** : mêmes formules d'éclairage en GLSL généré depuis la même source que le WGSL, tampons d'index persistants, `WEBGL_multi_draw`, un dessin par matériau et non par objet (matrices d'instance en texture), transparents triés, textures et mips gérés par le runtime. Critère : parité au pixel avec WebGPU sur toutes les scènes du banc (erreur max ≤ 2 par canal, expliquée), CPU < 8 ms sur Emerald.
R7b. **Ce qu'une instance coûte, et ce qu'elle ne coûte pas.** Poser N fois le même objet n'alloue
**aucune géométrie de plus**, sur aucun des deux moteurs : sommets, indices, UV, normales et
tangentes appartiennent à la géométrie source, jamais au placement, et la forme de son DAG —
hiérarchie de culling, bornes par nœud, bandes d'erreur, paquets de streaming, liens de groupes,
identités de clusters — est calculée une fois par objet et relue par chaque placement. Ce qu'un
placement possède en propre est ce qui le distingue : sa matrice monde, sa boîte monde, son rang de
dessin, ses drapeaux de groupes forcés, et un enregistrement par cluster — parce que sa coupe lui
appartient, l'erreur projetée dépendant de sa distance. Le budget de pages ne compte pas deux fois
un cluster posé deux fois (R3b). Critère : `geometryAllocationBytes` identique à 1 et à N instances
(Emerald, WebGPU 209,1 Mo, WebGL2 223,3 Mo à 1 comme à 9), image identique à 0 px.

R8. **API scène** : `addObject(cache, transform)`, `removeObject`, `setTransform`, `setMaterial`, `setCamera`, `pick(x, y)` (rayon contre clusters visibles et triangles réels), événements de résidence et de chargement. Critère : opérations appliquées à l'image suivante, sans allocation par image.
R9. **Métriques honnêtes** : rAF, CPU par étape, GPU par passe (WebGPU) ou `null`, triangles soumis et sélectionnés selon le même contrat pour tous les moteurs, `pagesDetached`, `cacheEvictions`, trous mesurés par le SDK lui-même. Critère : champs identiques entre moteurs, aucune valeur déduite.

## 4. Mode édition

E1. **Objet éditable** : un objet importé existe sous deux formes : source (triangles bruts) et compilée (clusters). Le moteur affiche la forme compilée par défaut.
E2. **Gestes instantanés** (sans recompilation) : ajouter, retirer, dupliquer, déplacer, tourner, mettre à l'échelle, changer matériau ou texture, visibilité. Critère : effet à l'image suivante.
E3. **Sculpture et modification de maillage** : pendant le geste, l'objet s'affiche depuis sa forme source (chemin direct, sans LOD) ; au relâchement, recompilation de cet objet seul en arrière-plan (wasm dans un Worker, ou binaire natif si hôte Electron) ; échange à chaud quand le cache est prêt, ancienne version affichée jusque-là. Critère : aucune image manquante pendant l'échange, recompilation ≤ 500 ms pour 100 000 triangles.
E4. **Historique** : chaque version compilée adressée par empreinte ; annuler = réafficher un cache existant ; garbage collection des versions non référencées. Critère : annuler/refaire en < 16 ms.
E5. **Outils dessinés par le moteur** : poignées, sélection, grille, boîtes, tout est rendu par notre runtime (pas de canvas Three superposé). Critère : aucune dépendance Three.js dans l'éditeur hors importation si elle y reste transitoirement.
E6. **Projet** : un fichier de projet référence sources, options, caches par empreinte, scène ; rechargeable à froid sans recompiler ce qui n'a pas changé.

## 5. Mode final (cuisson)

F1. **Commande unique** : `compile --final <projet> <sortie>` produit un dossier statique complet.
F2. **Optimisations globales** : recompilation de tous les objets avec les mêmes options ; **blocs de quartier** : objets voisins fusionnés en un DAG de scène pour les vues lointaines (règle du pixel identique) ; ordre des paquets selon les parcours probables ; textures en mips streamables ; déduplication par empreinte.
F3. **Runtime livré** : le SDK de rendu seul (quelques centaines de Ko), sans compilateur, sans éditeur, sans Three.js. Chargement par un simple dossier statique ou un CDN, `Cache-Control: immutable`.
F4. **Critère** : sur Emerald × 9, vue générale < 2 M triangles sélectionnés, 120 FPS présentés en WebGPU, première image < 1,5 s à froid et < 500 ms à chaud, image identique au mode édition au même seuil.

## 6. Banc et preuve

B1. Three.js reste le **moteur témoin** dans le Lab : même scène, même caméra, capture PNG sans perte, comparaison au pixel à 0 px (identité attendue) et à 1 px (différences localisées aux bascules), témoin A/A.
B2. **Parité WebGPU/WebGL2** : test automatique sur toutes les scènes, erreur max ≤ 2 par canal, sinon échec.
B2bis. **Antialiasing temporel** (WebGPU, actif par défaut) : l'accumulation ne touche que les deux pixels d'un bord, l'intérieur des surfaces reste à 0 px, deux exécutions rendent la même image au bit près, une image n'est tenue qu'après un plein cycle d'images immobiles, et un objet déplacé ne laisse aucun fantôme ; les bancs à 0 px le coupent (`temporalAntialiasing: false`).
B3. **Campagnes** : fenêtre visible à 120 Hz, machine libre, mode mesure sans trace, ABBA, DPR/pixelError/résolution/commit consignés, quatre moteurs, 1 et 9 instances, toutes les scènes ; verdict par scène et moteur (FPS présentés, p95, p99, images > 8,33 ms, pixels différents, première image).
B4. **Scripts headless** conservés dans `render-tech-lab/scripts/headless/` pour les preuves rapides de chaque fusion.

## 7. Risques et décisions prises

- Quantification des sommets : acceptée, l'erreur de quantification entre dans l'erreur certifiée (décision du 14 septembre).
- Compression de textures avec perte : acceptée pour les textures seules (décision du 17 septembre 2026, Textures T5) — BC sur ordinateur, ASTC sur mobile, à livrer avec les images avant/après et l'écart mesuré publié. Les seuils 0 px du banc ne s'appliquent pas à ce lot ; ils restent entiers pour la géométrie et l'éclairage. Mips streamables sans perte d'abord.
- FBX : lecteur libre imparfait ; glTF reste le pivot, conversion en amont si nécessaire.
- WebGL2 : jamais le même pipeline que WebGPU (pas de compute) ; parité exigée sur l'image, pas sur la méthode.
- Trois mois d'agents estimés pour les phases 1 à 7 ; les phases 1 à 3 donnent déjà un moteur de rendu livrable.
