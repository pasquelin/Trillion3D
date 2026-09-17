# Backlog

Une ligne = une tâche. Les règles de travail sont dans [`AGENTS.md`](AGENTS.md), la cible du moteur
dans [`docs/SPEC_MOTEUR_SANS_THREE.md`](docs/SPEC_MOTEUR_SANS_THREE.md), l'historique et les
décisions dans Git.

## Géométrie

Les lots 1, 2 et 4 font disparaître le lag ; 5, 9 et 11 rapprochent de la référence ; 10 passe avant 5.

1. **Fait, moitié processeur** : coupe publiée comme une différence par les deux chemins sous un contrat unique, lecteurs tenus sur l'entrant/sortant ; `webgpuBudgetRanking`, `gpuDagRuntime` et `webgpuFrameHold` fondus dedans. **Reste la moitié GPU** : le noyau garde l'appartenance et n'écrit que l'entrant/sortant dans deux plages de `flags` réservées une fois — demande d'abord un protocole de resynchronisation (relevé jeté sur changement de révision, deux relectures entre deux adoptions, copie sautée fente occupée), une plage de journal séparée de la liste des candidates, et l'oracle `gpuDagOracle*` au même contrat. Après le lot 10. Fichiers `gpuDag*`.
2. **Fait, scène simple face** : les transparents paginés d'un même pipeline tiennent en une tranche, le plan trié est lu par la carte seule, l'argument indirect par item a disparu — 3 008 appels → 9 au banc `transparents-ordres`. **Rien n'est gagné en double face** (6 016 → 6 016) : dos et face posent deux pipelines par item, aucune tranche ne fusionne ; porter le côté par instance sous un pipeline sans élimination matérielle coûte +42 % de passe transparente (11,0 → 15,4 ms, apple metal-3), refusé tant qu'une autre forme n'est pas trouvée. **Reste** : la transmission garde une tranche par entrée tant que le volume du matériau est un uniforme à décalage dynamique (le rapatrier porte `VSOut` à seize variables inter-étages, le plancher garanti) ; une primitive non paginée garde son appel tant que sa géométrie n'est pas concaténée. Fichiers `webgpuBlend*`.
3. **Fait** : la descente entière tient dans une passe, chaque niveau lancé à plat sur la taille de son étage, six commandes par image au lieu de 3·profondeur+3 — 0,26 → 0,15 ms à profondeur 5, un niveau valant ~26 µs ouvert derrière ses copies contre ~1,4 µs à plat (banc `coupe-lancements-gpu`, mêmes pages au bit près). **L'élagage par le haut est livré** : le nœud porte le plancher d'erreur du sous-arbre et la sphère qui l'englobe (16 → 24 flottants), que `cullingBounds` dérive des pages à la préparation — rien du compilateur, rien du format —, et `errorFloor` le projette en WGSL. Mesuré sur apple metal-3 (`elagage-haut-gpu`, coupe identique au bit près dans les quatre poses) : candidates et vivantes retirées de 24,3 % de face, 24,5 % de biais, 45,2 % de loin, 99,1 % au contact — cette dernière sur une coupe vide, tout y étant trop grossier. Justesse : `plancher-erreur-cpu-gpu` compare coupe processeur, oracle et noyau WGSL sur la carte, `gpuDagCutFloor.test.ts` interdit qu'une grappe retenue disparaisse, et `coupe-lancements-gpu` retrouve les mêmes pages et les mêmes dessinées que la descente d'avant. **Persistance refusée** : la frontière doit être réexaminée à chaque image, ce qu'une coupe gardée économiserait plafonne à 0,47 % (`gpuDagCutFrontier.test.ts`). **Fils persistants refusés** : WGSL ne garantit aucun progrès entre groupes de travail. **Reste** : le gain en millisecondes de la liste vivante rétrécie n'est pas mesuré, seule sa taille l'est ; et à l'image où une primitive se met à escalader, son seuil franchit un plancher élagué et elle retombe une image sur sa couverture épinglée — l'image suivante élague au seuil escaladé et retrouve ses étages. Fichiers `gpuDag*`.
4. Pompe de textures : (a) note mise à jour seulement par grappe entrée/sortie, file par insertion ; (b) textures virtuelles — 1 pixel sur 16 incrémente un compteur par tuile dans la passe de résolution, lu par `mapAsync` une image en retard, texture d'indirection pour l'atlas ; en WebGL2 par une petite image relue. Deux lots.
5. Une coupe par grappe, placements en index : 163 316 grappes × 12 placements = 1 959 792 fiches de 96 octets (`webgpuPagesLayout.ts:25`, `gpuDagPack.ts:153`) ; fiches uniques, placement en index dans la fiche de travail. Mémoire GPU ÷ 12. Après 1–4 et 10.
6. Image tenue conservée à l'arrivée d'une page qui ne change rien à l'écran (`webgpuPagesPageApi.ts:37-44`).
7. Surveillance de scène par version : `hostSceneWatch` compare 4 300 nœuds × 18 valeurs par image (`frameGateCore.ts:125`).
8. Priorité par erreur d'écran sur WebGPU (`webgpuPagesHostApi.ts:123`), comme le chemin WebGL2 (`streamingPriority.ts:66`) : à cache froid le lointain arrive avant le proche.
9. Hi-Z : choisir les occulteurs par visibilité passée au lieu de la médiane de profondeur (557 352 lignes classées pour 21 955 testées), puis deux passes — dessiner le visible, bâtir la pyramide, re-tester les rejetés dans la même image.
10. Filets de sécurité (sur verdict « plus de lag », avant le lot 5) : preuve de navigation sur la scène réelle ; réécriture des tests caducs (`webgpuRowCommit`, `gpuDagLive`, `gpuDagSelection*`, `webgpuBindEntries`, `frameCostAudit`, `webgpuPages.11`, hôte de test de coupe du Calculateur, et les six `webgpuPages` rouges depuis b72278c6) en disant pour chacun si c'est le test ou le code qui est faux ; banc bit à bit du raster de calcul contre l'ancien raster matériel ; simplify puis tableau référence / nous mesuré.
11. Compression des sommets hors ligne : positions quantifiées par grappe (14–16 bits/axe), normales 2 octets, UV entiers — ~3× moins que les ~48 octets par triangle actuels. Compilateur Rust, nouvelle version de format de page.
12. Ombres par la même géométrie : même sélection, même raster, mêmes pages depuis la lumière.
13. Matériaux par classes : une passe par matériau avec profondeur matérielle au lieu d'un branchement par pixel.
14. Eau en passe plein écran dédiée (copie du fond déjà en place pour la transmission).
15. Noyaux Rust/Wasm M5 sur la coupe WebGL, la coupe de secours et la reconstruction des rangs.
16. Compilateur : `dag/groups.rs:20` n'applique pas `DAG_GROUP_MIN` ; `lib.rs:101` constante morte `CLUSTER_TRIANGLES = 256`.
17. `dagWanted` : un mot compact par grappe (nœud, drapeaux, monde) pour ne plus enregistrer les 80 % de grappes rejetées, à mesurer contre les 0,6 ms de la tête de sélection.
18. `flatHierarchy` laisse le plafond d'erreur du sous-arbre à -1 et la sphère du remplaçant à zéro : une primitive dont le manifeste ne porte pas de hiérarchie n'est donc élaguée ni par le haut ni par le bas, et perd le levier mesuré à 24-45 % sur les candidates. Les dériver des pages comme `cullingBounds` le fait déjà ; la fixture `gpuDagCutFrontierScene.ts` les remplit aujourd'hui pour pouvoir mesurer, ce que le producteur devrait faire. Demande la même preuve que le lot 3.
19. `orderBlendPasses` refait quatre parcours complets des items par image — clés à l'œil, rejet par le tronc, puis les deux tris — même quand l'œil et les six plans sont ceux de l'image précédente. Sortir tôt sur l'empreinte de la vue, comme `keepMoved`/`orderMoved` le font déjà pour les envois.

## Lumière

1. Image stable d'abord : caméra mobile, 8 lampes + soleil donne 0 / 1 392 / 6 278 px sur 3 exécutions identiques et 14 erreurs de page par exécution. Isoler deux fois chaque cas — caméra fixe, soleil seul, lampes seules, ombres coupées, aucune lampe — et lire les erreurs. Fini quand 3 exécutions donnent 0 px.
2. Occulteurs d'ombre hors écran (`webgpuPagesEncodeShadowPass.ts`) : un mur derrière la caméra doit ombrer le sol visible.
3. Proxy lointain et rebond qui suivent les objets déplacés (`webgpuPagesTransform.ts`) : une porte déplacée déplace l'ombre lointaine et le rebond.
4. Toutes les lampes contributrices par tuile : retirer le plafond de 32 et donner une profondeur de tuile aux surfaces transparentes contre le ciel (`gpuLightTilesShader.ts`). 33 lampes, aucune perdue.
5. Test d'ombre du rebond pour chaque lampe (`bounceSurfaceWgsl.ts`) : aucune fuite à travers un mur avec 5 lampes.
6. Rejet des occulteurs dans le budget d'ombres (`stageMapping.ts`), puis saut du test derrière une surface, atlas à la demande, proxy seulement avec un soleil, profondeur conservée sur un simple changement de couleur. 0 px.
7. Miroirs : repartir de develop, réutiliser la fixture `classes-materiaux/miroir.gltf` et les patches `.mesure/patches/lot-reflet/` (+ `lot-reflet.bundle`, base d48b66a) comme lecture, trouver pourquoi on/off = 0 px. Fini quand les cubes apparaissent dans le sol métallique.
8. Copies publiques de lampes détachées (`explorerLightApi.ts`) : muter une copie ne touche jamais l'interne.
9. Coût GPU de la vue au sol, 3,65 → 6,49 ms à 0 px : bissection, sur machine calme seulement.
10. Après 7 : réflexions rugueuses, ombres colorées semi-transparentes, translucidité du feuillage. Aucune conversion BLEND → MASK à l'import : la référence ne reclasse jamais un matériau, elle exige que la donnée arrive déjà masquée (sa géométrie virtualisée n'accepte que l'opaque et le masqué). Le travail est côté compilateur, pas côté moteur.
11. Rebond 3 (`lot/rebond-3`) : cascades de sondes autour de la caméra, budget en millisecondes plutôt qu'en nombres de maillages et de rayons, base d'harmoniques sphériques d'ordre 2, activé par défaut quand le budget tient.
12. Ombres des matériaux en mélange : une grappe transparente n'obtient pas de ligne de visibilité (`webgpuRowSync.ts`), n'entre jamais dans la table des rangs dessinés des cartes d'ombre et n'ombre rien. L'ombre atténuée et colorée d'une surface semi-transparente reste un lot à part.
13. Éclairage stochastique par pixel (RX2) : le rejet par tuile est livré, l'échantillonnage non. L'historique doit passer par une cible de rendu supplémentaire en ping-pong, pas un tampon de stockage. Demande aussi un banc où les lampes atteignent vraiment les surfaces transparentes.

14. Vue sans lumière : reprendre le correctif b57ebd89 (« unlit WebGL publie l'albédo brut, métal compris »), aujourd'hui commit non référencé — `git branch hold/unlit-albedo-three b57ebd89` avant qu'il soit ramassé. La référence affiche la couleur de base telle quelle, métaux compris ; notre noir vient de l'ambiant π appliqué sur le PBR, où le diffus d'un métal est nul par construction. Pas de capacité « non fidèle sur les métaux » à déclarer.
15. Couvrir `createDeferredLayouts` dans `webgpuBindBudget.test.ts`, et exécuter `prepareWebgpuPages` de bout en bout : rien ne le fait aujourd'hui.

## Textures

1. Verdict de l'utilisateur sur T1 (fusionné f43f6a44) : route `/?test=15-virtualized-integration`, ce que la caméra regarde net d'abord.
2. T1b — compteurs textures dans le Lab (octets résidents / budget, textures au bon niveau, niveaux manquants) : une ligne dans le panneau du banc 15, rien d'autre.
3. T1c — vraie libération : les niveaux nets devenus inutiles rendus au budget (atlas alloué d'avance aujourd'hui) ; sans ça le budget ne tient pas sur petite machine, et le pool fixe de T4 en dépend.
4. T2 — traversée à cache froid : temps par image plafonné pour les transferts, report à l'image suivante, aperçu dessiné tant que le niveau manque ; regarder p95 et pic, pas la médiane.
5. T3 — priorité par lecture de l'image rendue au lieu de l'estimation par taille à l'écran : 1 pixel sur 16 incrémente un compteur par tuile demandée dans la passe de résolution, lu par `mapAsync` une image en retard. C'est le retour d'image de la référence, et le même mécanisme que le lot Géométrie 4b : un seul chemin pour les deux.
6. T4 — tuiles de taille fixe dans un pool physique à budget constant, seules les tuiles vues résidentes, texture d'indirection pour dire où est chaque tuile (ou quel niveau grossier prendre en attendant). Remplace l'atlas dimensionné sur la plus grande texture et les classes de taille (`atlasClasses` 2 abandonné).
7. T5 — compression GPU des blocs à la cuisson (BC sur ordinateur, ASTC sur mobile), perte acceptée et jugée à l'œil, tuiles comprises : c'est le seul moyen de tenir le budget mémoire de la référence (7,56 Go de RGBA brut sur Emerald aujourd'hui). À livrer avec les images avant/après et l'écart mesuré publié ; les seuils 0 px du banc ne s'appliquent pas à ce lot, ils restent entiers pour la géométrie et l'éclairage.

## Compilateur

1. Réutiliser un produit compilé complet quand chaque empreinte de dépendance et le produit existent déjà, au lieu de reconstruire le DAG. Sortie identique à l'octet, comme les tâches 2 à 5.
2. Coupe linéaire pour les n-gones convexes dans `ngon.rs` (quadratique aujourd'hui, 8 000 coins = 113 ms) ; les faces concaves gardent la coupe en oreilles.
3. Décoder chaque image partagée une seule fois dans `texture_preview.rs` (cache borné par empreinte, une pyramide par seuil MASK).
4. Extraire un unitypackage en une passe, en gardant CRC, bornes, annulation et sans publication partielle.
5. Admission avant import, et points d'annulation dans les longues coupes de n-gones et le calcul des normales.
6. Garder les blocs DDS/KTX2 sur le GPU sans les décoder.
7. Accepter en entrée le glTF compressé Draco et meshopt.
8. Map industrielle sur le banc 15.
9. Vérification de licence FAB pour le corpus.
10. Classer en masqué, à l'import, tout matériau dont l'alpha est réellement binaire et qui arrive déclaré en mélange, quand la donnée source le dit — sans jamais reclasser un vrai transparent. C'est ce qui remplace la conversion BLEND → MASK côté moteur (Lumière 10).

## Calculateur

1. Sur go de l'utilisateur : notre propre moteur de rendu WebGL2, puis l'API hôte sans types Three. `PageRec.matrix` et `ClusterRoot.world` sont déjà des matrices remplies par le moteur (`hostWorldPlacements.ts`) ; les aplatir en `Float64Array` ne demande rien à l'hôte, seuls ses lecteurs — `addInstance`/`updateInstance` et les moteurs témoins — prennent encore un `THREE.Matrix4`. Une trentaine de fichiers lisent `.elements`.
2. Rafraîchissement ciblé d'un nœud déplacé : `setWebgpuTransform` recalcule tout l'index moteur (`hostWorldPlacements.refresh`) là où `updateWorldMatrix(true, true)` ne parcourait que les ancêtres et le sous-arbre — hors chemin d'image, mais O(scène) par `setTransform`. `updateNodeWorldMatrix` (`packages/sdk-core/mathTransformTreeUpdate.ts`) suffit.
3. À mesurer quand c'est commode : gain des pages en mémoire partagée (`--isolation on` vs off) et du chemin Wasm (`--chemin-math js` vs `wasm`) ; `normalMatrix3` par fragment dans `visibilityShadingNormal.ts` ; listes de lampes de `gpuLightTilesShader` à ciel ouvert.
