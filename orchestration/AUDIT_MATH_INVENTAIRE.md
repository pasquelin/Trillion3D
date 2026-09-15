# Inventaire des calculs mathématiques (15 septembre 2026)

Base : commit `ea032f4`, worktree `audit-calculs-math`. Lecture seule par onze agents Sonnet 5 (Rust : 3, sdk-core : 1, sdk-browser : 7), sections condensées par le chef. Périmètre : `packages/asset-compiler-rust`, `packages/sdk-core`, `packages/sdk-browser`, `packages/sdk-node` (aucun calcul), `packages/page-codec` (encodeur de référence, hors chemin chaud). Tests, fixtures et oracles CPU sont listés mais marqués « nul » : ils ne s'exécutent pas en rendu.

Convention des colonnes : Fréquence (par image / par cluster / par page / chargement / compilation), Motif coûteux, Idée, Risque sur l'image (nul = résultat identique au bit près ; faible = ordre flottant à vérifier ; à vérifier = peut changer une décision de sélection ou d'éclairage).

## asset-compiler-rust : compiler_*.rs (25 fichiers, à la compilation)

| Fichier:lignes | Ce que ça calcule | Fréquence | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|
| `compiler_world.rs:89-134` | `world_matrices` : matrices monde de tous les nœuds | recalculé **deux fois** par compilation (`coplanar/pairs.rs` et `coplanar/surface.rs`) | double calcul intégral | calculer une fois et partager | nul |
| `compiler_primitive_bundle.rs`, `compiler_primitive.rs` | SHA-256 cluster + bundle + geometry sur des données déjà hachées ailleurs | par page/bundle | hachages redondants | réutiliser les digests | nul |
| `compiler_accessor_decode.rs` | chemin lent : offset complet recalculé à chaque sommet/composante | par sommet | multiplications répétées | curseur avancé | nul |
| `compiler_primitive_bundle.rs:66-68` | AABB par cluster, f32→f64 par composante dans la boucle | par cluster | conversions | à vérifier (arrondi stocké) | à vérifier |
| `compiler_primitive_dag.rs:53-71` | statistiques par niveau : rebalaye tout le vecteur de clusters à chaque niveau | par niveau | O(niveaux × clusters) | un seul regroupement | nul |
| (intégrité) | fingerprint des triangles calculé deux fois | par primitive | duplication | une seule passe | nul |

## asset-compiler-rust : DAG, import, manifest binaire (21 fichiers, tout à la compilation)

Point chaud dominant : `qem.rs::simplify_with_locked_vertices` via `dag/groups.rs:125-134` dans `dag/build.rs:85-95` (rayon). Fold séquentiel non commutatif `merge_spheres` (`dag/bounds.rs:42-81`) : ne jamais paralléliser ni réordonner.

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `dag/bounds.rs:1-8` | `point()` : index×3, cast f32→f64 | par sommet, millions d'appels | 3 floats | fonction potentiellement non inline | `#[inline]` | faible |
| `dag/bounds.rs:11-40` | `bounding_sphere` : AABB puis rayon (sqrt+powi par sommet), 2 passes | par cluster et par groupe | ~128 sommets | `powi(2)` + double indirection | `x*x` au lieu de `powi(2)` (même résultat IEEE) | à vérifier |
| `dag/build.rs:14-20` | `first_use` : `offset/3` par indice | par mesh | millions | division par indice | compteur incrémenté | nul |
| `dag/build.rs:54-68` | `lists`/`centres` recollectés à chaque niveau | par niveau (≤32) | milliers | 2 Vec réalloués par niveau | `with_capacity` / recalcul partiel | nul |
| `dag/build.rs:96-144` | assemblage post-réduction, `push` et `with_capacity` par groupe | par niveau | — | réallocations | pré-dimensionner `dag` | nul |
| `dag/clusters.rs:36-54` | reconstruction depuis meshlets : 2 `get` (Option) par coin | par cluster | 128×3 | double bounds check | pré-valider une fois | nul |
| `dag/clusters.rs:70-114` | `cluster_adjacency` : HashMap locale par cluster, `sort_unstable` global des arêtes de bord, boucle imbriquée | par niveau | E log E | tri global | `HashMap<u64, SmallVec<u32,2>>` sans tri | nul |
| `dag/clusters.rs:155-173` | `level_locks` : `Vec<u32>` de taille `weld.len()` réalloué **à chaque niveau** | par niveau | tous les sommets du mesh | allocation entière du mesh par niveau | réutiliser ou map creuse | nul |
| `dag/culling.rs:12-25` | `boxes`/`centres` : recalcule les AABB depuis les indices bruts | une fois | tous les clusters | redondant avec `bounding_sphere` | mémoriser les AABB pendant la construction | nul |
| `dag/culling.rs:70-139` | BVF de culling : 3 `sort_unstable_by` imbriqués par nœud, `low/high` recalculés | par nœud | O(n log n) total | tri complet pour une médiane | `select_nth_unstable` → change l'ordre `order[]` → à vérifier | à vérifier |
| `dag/groups.rs:3-53` | `group_clusters` : bisection, tri complet puis `refine_bisection` puis re-tri | par niveau | n log n | tri pour une médiane | `select_nth_unstable_by` change la topologie du DAG → à vérifier | à vérifier |
| `dag/groups.rs:55-100` | `refine_bisection` : `HashSet<usize>` recréé par split, 2 passes | par split | taille du groupe | HashSet par appel | `Vec<bool>` indexé, réutilisé | nul |
| `dag/groups.rs:104-134` | `reduce_group` : `merged` par `extend_from_slice` sans capacité | par groupe | 8-32 × 128 tri | réallocations | `with_capacity(sum)` | nul |
| `dag/groups.rs:140-153` | 2 `HashSet<u32>` (`required`, `kept`) par groupe pour vérifier le bord | par groupe | centaines | 2 hachages complets | `Vec<bool>` indexé par sommet canonique | nul |
| `import.rs:46-60` | `CornerHasher` : hachage octet par octet | par coin, dizaines de millions | 1-4 octets | `write` octet à octet | `write_u32` par composante | nul |
| `import/mesh.rs:39-101` | dédup des coins : hachage + lookup par coin, normalisation à la 1ʳᵉ apparition, min/max branchés ; `Vec::new()` l.40-44 sans capacité | par coin importé, millions | — | Vec sans capacité | `with_capacity(count*3)` | nul |
| `import/mesh.rs:131-147` | `flat_map(to_le_bytes).collect()` | par partie | indices | Vec sans capacité | `with_capacity` | nul |
| `import/scene.rs:94-160` | dédup mesh : clé `(u32, Vec<Option<usize>>)` allouée par nœud | par nœud | milliers | Vec par lookup | clé hachée précalculée | nul |
| `import/textures.rs:62-107` | jusqu'à 15 `PathBuf` + `is_file()` par texture | par texture | 15 E/S | E/S en boucle | cache par nom de fichier | nul |
| `manifest_binary/format.rs:12-38` | `Column::f64/i32/u32` : `extend_from_slice` sans réservation | par valeur, millions | 1 | réallocations | pré-dimensionner les colonnes | nul |
| `manifest_binary/format.rs:66-79` + `page.rs:9-64` | `vector()` : alloue un `Vec<f64>` de 3-4 par sphère/bounds, par page | par page, dizaines de milliers | 3-4 | allocation par vecteur | écrire directement dans la colonne | nul |
| `manifest_binary.rs:129-168` | `digests` : `String` par entrée non nulle | au chargement | dizaines de milliers | allocations | `&str` empruntés | nul |
| `lib.rs:107-153` | `with_ratio` : `Mutex` par événement de progression | par événement | milliers | verrou | atomiques | nul |

## asset-compiler-rust : coplanarité, QEM, topologie (15 fichiers)

Zone INTOUCHABLE (ordre des sommations flottantes détermine quelles surfaces sont coplanaires) : `plane.rs::plane_of_triangles` (47-140), `plane.rs::same_plane` + `groups.rs` (28-55), `surface.rs::collect` (144, 152), `assign.rs` (tri + plus long chemin), `overlap.rs::cover`/`in_plane`.

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `coplanar/overlap.rs:64-134` | `footprint()` : transforme chaque sommet de chaque triangle dans le plan, projette 2D | par surface (cache `prints`) | jusqu'à 2 M triangles → 6 M `transform_point` | `Vec` sans `with_capacity` ; mat4×point + 2 dot par sommet | `reserve(indices.len())` ; rayon par triangle (ordre sans effet sur `cover`) | à vérifier (`in_plane` epsilon) |
| `coplanar/overlap.rs:147-179` | `cover()` : rasterise dans une grille de bits 256² via barycentriques, 2 divisions par cellule ; `into.fill(0)` de 1024 mots à chaque appel | par paire testée (2×) | 65536 cellules × triangles | fill complet ; 2 div/cellule | fill limité à la zone utile ; `1/area` précalculé change l'arrondi → NON | à vérifier |
| `coplanar/overlap.rs:182-187` | `shared()` : AND + popcount | par paire | 1024 mots | — | SIMD entier, résultat identique | nul |
| `coplanar/groups.rs:28-55` | fusion des plans : 81 voisins de quantification par bucket, lookup BTreeMap + `same_plane` | compilation, par bucket | k × 81 | 81 itérations par bucket | ne tester que les voisins pertinents → change les fusions → NON sans preuve | à vérifier fortement |
| `coplanar/assign.rs:17-37` | `key()` recalculée à chaque comparaison du `sort_by` (to_bits, to_be_bytes, Reverse) | compilation | n log n | clé recalculée par comparaison | précalculer les clés (valeur identique) | à vérifier (ordre total) |
| `coplanar/assign.rs:44-52` | adjacence `below[over].push(under)` en Vec<Vec> | ≤ 4096 overlaps | petit | allocations | CSR | nul |
| `coplanar/pairs.rs:20-52` | double boucle O(n²) sur les membres d'un plan | par plan | ≤ 64² = 4096 paires | pas de court-circuit avant `test_pair` | grouper par (node, material) avant | faible |
| `coplanar/pairs.rs:74-131` | `test_pair()` : rectangles, empreintes, cover×2, shared | par paire | — | cache `prints` jamais libéré (mémoire de crête) | libérer plus tôt | à vérifier |
| `coplanar/placement.rs:4-28` | `world_plane()` : cofacteur, sqrt, normalisation, canonicalisation | par cluster avec plan | dizaines de milliers | sqrt + div + mat4 | SIMD même formule | à vérifier (clé de hachage) |
| `coplanar/placement.rs:31-51` | `extend_box()` : 8 coins transformés | par page exacte | 8 | 8 transform_point | déjà minimal | nul |
| `coplanar/plane.rs:47-140` | `plane_of_triangles()` : 3 passes (cross+aire+normale pondérée+bbox ; normalisation ; offset ; tolérance+parallélisme) | par cluster candidat | 64-128 tri × 3 passes | 3 boucles séparées, sqrt par triangle en passe 3 | fusionner SEULEMENT si l'ordre d'accumulation est strictement conservé | à vérifier (intouchable) |
| `coplanar/plane.rs:10-25` | dot/length/cross/scale | millions d'appels | O(1) | vérifier `#[inline]` | — | nul si même ordre d'opérations |
| `coplanar/plane.rs:148-163` | `plane_frame()` : base 2D du plan | par plan, possiblement recalculé dans `footprint` | O(1) | duplication possible pairs.rs / footprint | mémoriser (u,v) par plan | à vérifier |
| `coplanar/surface.rs:63-154` | `collect()` : nœuds×primitives×pages, `BTreeMap drafts` recréée par primitive, tri local (144) + tri global (152) | compilation | dizaines/centaines de milliers de pages | BTreeMap recréée ; double tri | scratch réutilisé ; tris à conserver exactement | à vérifier fortement |
| `qem.rs:13-63` | `compact_region()` : compaction sommets + table locale→source, dense ou HashMap | par région | centaines-milliers de sommets | `Vec::new()` sans reserve ; HashMap reconstruit | `reserve` avec borne connue | nul |
| `qem.rs:67-123` | wrapper `meshopt::simplify_with_locks` (QEM dans la crate externe) | par région | — | boîte noire meshopt | version / SimplifyOptions | à vérifier |
| `topology.rs:25-137` | `classify_topology()` : demi-arêtes, CSR liens, `sort_unstable_by` (80-85), balayage, `classify_link` par sommet | par cluster | E = 3×tri, O(E log E) | le tri est le poste principal | bucket/comptage par clé (min,max) au lieu du tri | faible |
| `topology/link.rs:6-89` | `classify_link()` : `.iter().position()` O(d²), DFS composantes, 3 `Vec::new()` par sommet | par sommet | d ≤ 8 × tous les sommets | 3 allocations par sommet | scratch réutilisé (`clear()`) | nul |
| `geometry_page.rs:28-50` | renumérotation locale via `HashMap<u32,u32>` alloué par page | par page | ≤ 65535 | HashMap par page | scratch réutilisé | nul |
| `geometry_page.rs:64-93` | écriture des sommets attribut par attribut, `copy_from_slice` de 4 octets | par sommet | ≤ 65535 | petites écritures | quasi optimal | nul |
| `perf.rs:38-54` | `Timer` `fetch_add` atomique | par section | — | contention possible en boucle parallèle | agréger par thread | nul |
| `accessor_validation.rs`, `coplanar.rs:95-163`, `report.rs` | validation entière, quantum d'offset, rapports | une fois | — | — | — | nul |

## sdk-core (53 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `projectionOracles.ts:27-73` | `maxStretch` : plus grande valeur singulière 3×3 (sqrt, acos, cos, `**2`) | par cluster, par image (selon appelant) | 1 | transcendantes par appel | cache par matrice (déjà fait côté `worldStretch`) | à vérifier (LOD) |
| `projectionOracles.ts:87-120` | `clusterErrorPixels` : sqrt + divisions | par cluster, par image | milliers | sqrt par cluster | comparaison au carré côté appelant | à vérifier (LOD) |
| `projectionOracles.ts:123-136` | `coneRejects` : `Math.sin` | par cluster | 1 | — | — | faible |
| `oracles.ts:47-72` | `edge`/`barycentric` : tableaux `readonly number[]` par appel, 3 divisions par `area` | par pixel × triangle si raster logiciel | énorme si sur le chemin | allocation + divisions | inliner, `1/area` | à vérifier |
| `oracles.ts:11-34` | `exclusiveScan`/`compact` : nouveau tableau par appel | par image | n | allocation | buffer réutilisé, typed | faible |
| `hizOracles.ts:5-42` | `hizReduceCeil`/`hizBuildPyramid` : `number[][]` réalloués, `[...row]` par niveau | par image si chemin CPU | w×h | boxing + copies | Float32Array plat | à vérifier |
| `hizOracles.ts:48-83` | `hizFootprintFar` : double boucle bornée | par cluster, par image | ≤16×16 | — | — | à vérifier |
| `lightingTransportVisibility.ts:53-133` | triple boucle patch × rayon × surface, `intersectSurface` par test, 2 passes (statique/mobile) | par image (rebuild) | jusqu'à dizaines de millions | aucune accélération spatiale | grille/BVH, ne retester que `patchChanged` | à vérifier (éclairage) |
| `lightingTransportSolve.ts:24-100` | Jacobi dense O(size² × iterations ≤256) + 2ᵉ passe O(size²) | par image | size² × it | dense, sans parcimonie ni SIMD | parcimonie, déroulement, WebGPU | à vérifier |
| `lightingTransportResidual.ts:1-29` | résidu max O(size²) 3 canaux | par image | size² | dense | lignes changées seulement | à vérifier |
| `lightingTransportGeometry.ts:38-104` | détection de changement O(size×12 + surfaces×15) | par image, toujours | 16 384 × 12 | jamais court-circuité | indicateur « scène figée » | à vérifier |
| `lightingTransportValidation.ts:33-69` | `Math.hypot(...patch.normal)` par patch | par image | size | spread par patch | `hypot(a,b,c)` ; valider une fois | à vérifier |
| `lightingTransportRays.ts:17-48` | `fillPatchRays` : cos/sin/sqrt par rayon | par patch changé | 64 | trig répétée | table de directions | à vérifier |
| `lightingSceneMath.ts:3-17` | `length` = `Math.hypot(...v)` | setup | — | spread | `hypot(v0,v1,v2)` | nul |
| `lightingSceneGeometry.ts:75-97` | patches : 3 spreads par patch | chargement | ≤16 384 | allocations | typed partagé | nul |
| `sceneLightShadowPlan.ts:91-156` | `plan()` : hypot/atan par lumière, sélection O(cand × 4) | par image | ≤64 | trig même si rien ne bouge | court-circuit « rien n'a bougé » | faible |
| `sceneLightShadowFaces.ts:86-102` | `multiply4` triple boucle | ≤24/image | 64 | boucle | dérouler | nul |
| `sceneLightShadowAtlas.ts:23-51` | grille 32×32 balayée | événementiel | 1024 | pas de free-list | free-list | nul |
| `manifestBinaryEncode.ts:80-185` | `writeSha` : 64 `charCodeAt` par sha | compilation | pages × 2 × 64 | boucle manuelle | `TextEncoder.encodeInto` | nul |
| `manifestBinaryDecode.ts:54-135` | `substring(64)` par page (×2) | chargement | dizaines de milliers | String par page | lazy / vues | nul |
| `manifestBinaryDecodeParts.ts:33-121` | `Array.from(subarray)` par groupe | chargement | milliers | copie typed→Array | garder `subarray` | nul |
| `stats.ts:8-42` | `[...values].sort()` par appel | télémétrie | milliers | tri répété | structure incrémentale | nul |
| `index.ts:30-70` | `compareImages` : Uint32 aligné + repli octet | tests | w×h | — | — | nul |
| `lightingTransportOracle.ts` | Gauss O(n³) | oracle hors mesure | — | — | ne pas toucher | nul |

## sdk-browser : sélection de pages (coupe du DAG)

Cœur chaud réel : `pageSelectionCut.ts` (sweep/retry), `pageSelectionCutVisit.ts` (traverse, pile explicite), `pageSelectionMath.ts` (projectCentre / boxClip / errorFloorPixels). Exécutés par image, par nœud du DAG ou par cluster candidat, des milliers de fois par image.

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `pageSelectionCutVisit.ts:60-136` | `traverse` : parcours du DAG de culling, pile `Int32Array(4096)`, `boxClip` + `projectedClusterError` + `nodeDecision` par nœud, `take()` par feuille | **par image, par nœud** | centaines à dizaines de milliers | boucle la plus chaude ; `throw` si pile déborde (l.126) ; forme des objets `SelectionState` à surveiller pour le JIT | garantir l'inlining, forme d'objet stable, pile dimensionnée | à vérifier |
| `pageSelectionCutVisit.ts:35-50` | `take()` : box clip → cutSelects → cône | par cluster candidat, par image | milliers | ordre déjà du moins cher au plus cher | — | nul |
| `pageSelectionCutVisit.ts:67` | repli sans hiérarchie : scan linéaire de toutes les pages | par image si `culling` absent | toutes les pages | pas d'accélération | garder rare | à vérifier |
| `pageSelectionMath.ts:110-134` | `boxClip` : AABB contre 6 plans (for p<24 step 4), ternaires `(a>0?max:min)` | par nœud ET par page, par image | 6 itérations × milliers d'appels | branches par plan | version sans branche (précalcul min/max par signe, ou p-vertex) | nul |
| `pageSelectionMath.ts:15-23` | `projectCentre` : 3 produits scalaires vers buffer partagé | par nœud/cluster, par image | milliers | déjà zéro allocation | — | nul |
| `pageSelectionMath.ts:25-62` | `projectedClusterError` / `cutSelects` : 2 projections par page | par page candidate, par image | milliers | sqrt dans `clusterErrorPixels` (sdk-core) | comparer en carré si possible | nul |
| `pageSelectionMath.ts:147-165` | `errorFloorPixels` : sqrt par nœud (2× par `nodeDecision`) | par nœud, par image | milliers | sqrt | comparaison au carré | nul |
| `pageSelectionCutNode.ts:24-63` | `nodeDecision` : 1 projectCentre + errorFloorPixels + clusterErrorPixels | par nœud testé, par image | milliers | fonction la plus appelée | déjà factorisé ; profiler | à vérifier |
| `pageSelectionCut.ts:83-86` | retry budget : double `pixelError` et **relance `sweep()` entier** jusqu'à 16× | par image si budget dépassé | 16 × tout le DAG | reparcours complet | dichotomie bornée par histogramme de la 1ʳᵉ passe | à vérifier |
| `pageSelectionCutSelect.ts:13-69` | `selectFlat` : traverse, forçage, puis **second `traverse` complet** (l.66) si `forcedAny` | par image, par racine | 2 parcours complets | parcours redondant pendant le streaming | retraverser seulement les sous-arbres forcés | à vérifier |
| `pageSelectionCutSelect.ts:42-58` | boucle `fallbackQueue` | par image en résidence incomplète | clusters manquants × sorties | clusters re-enfilés plusieurs fois | bitset « déjà enfilé » | faible |
| `pageSelectionCutLogic.ts:75-105` | `forceCoarse` : propagation par pile | par image en mode hold | groupes du sous-arbre | même producer repoussé plusieurs fois | tester `forced` avant push | faible |
| `pageSelectionCutLogic.ts:40-72` | `drawnUnderForcing` : 2 projections | par cluster en repli | — | 2 sqrt | — | à vérifier |
| `pageSelectionCutRepair.ts:8-26` | `rootCoverInto` : scan linéaire de toutes les pages d'une racine | par image, secours | dizaines de milliers | contourne la hiérarchie | restreindre au frustum connu | à vérifier |
| `pageSelectionCutRepair.ts:29-81` | `repairFlat` : jusqu'à 3 tours + reconstruction, 4 scans complets | par image, secours (sans `structure`) | 4 × toutes les pages | scans linéaires répétés | mémoriser le seuil convergé d'une image à l'autre | à vérifier |
| `pageSelectionCutLogic.ts:6-37` | `worldStretch` : cache via 9 comparaisons | par image, par racine | 9 | déjà optimisé | — | nul |
| `pageSelectionDiagnostic.ts:11-31` | `projectedPageError` (overlay) : recalcule `maxStretch` 2× et `pixelScaleOf` | par page affichée si overlay actif | — | recalcul sans cache | réutiliser le stretch de la coupe | à vérifier |
| `pageSelectionRequests.ts:77-96` | `collectPendingUrls` : `new Set<string>` par appel si `stamps` absent (l.82) | par image | shown.length | allocation par image | toujours passer `RequestStamps` | faible |
| `pageSelectionRequests.ts:64-76` | `indexPagesByUrl` : Map<string,T[]> | à vérifier | par page | clé chaîne | confirmer non appelé par image | à vérifier |
| `pageSelectionCollect.ts:34-168` | boucle par mesh : `metadata.primitives.find` dans la boucle → O(M×P) | chargement | M × P | recherche linéaire | Map précalculée | nul |
| `pageSelectionCollect.ts:117-129` | `count()` : clé chaîne `"i,j,k"` par triangle dans une Map | chargement | par triangle | concat + hachage de chaîne par triangle | clé numérique packée ou tri | nul (lourd au démarrage) |
| `pageSelectionCollect.ts:125` | `flatMap` + spread de `Uint32Array` | chargement | pages × triangles | double allocation, perte du typé | `Uint32Array` pré-dimensionné | nul |
| `pageSelectionCollect.ts:140-154` | union de Box3 : `new Box3`/`new Vector3` par page | chargement | par page | allocation dans la boucle | min/max scalaires | nul |
| `pageSelectionCollect.ts:59-108` | `sourceOrder`, `exactPages`, `.map` PageRec + push | chargement | dizaines de milliers de pages | 3 passes, push répété | une passe, pré-dimensionner | nul |
| `pageSelectionHelpers.ts:38-56` | `cullingNodes` : `Float64Array.from` + validation par nœud | chargement | par nœud | validation redondante en prod | valider seulement en dev | nul |
| `pageSelectionHelpers.ts:162-178` | `streamPlacement` : `.map` + `.every` | chargement | par page | 2 passes | 1 passe | nul |
| `pageSelectionCutBounds.ts:27-127` | `growSphere`, `cullingBounds` | compilation | par nœud | sqrt par fusion | — | nul |

## sdk-browser : Hi-Z CPU/GPU, sélection DAG GPU (32 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `hizDepth.ts:25-84` | `visibilityDepth` : raster logiciel par pixel ; **reprojette les 3 sommets du triangle à chaque pixel** (`projectVisibilityVertex`×3), barycentriques 3 divisions, interpole z | **par pixel, par image, CPU** | w×h (≈921 600 à 720p) | 3 transforms par pixel au lieu de par triangle | cache de projection par (page, triangle) ; `invArea` | à vérifier (doit rester bit-exact) |
| `hizDepth.ts:9-17` | `rowsOf` : `Float32Array` → `number[][]`, alloue `height` tableaux | par image (chaque pyramide) | w×h | boxing complet | pyramide en typed arrays plats | à vérifier |
| `hizTemporal.ts:37-104` | `applyTemporalHiz` : jusqu'à 3 rasterisations plein écran + 2 pyramides + `countUnoccluded` + `splitOccluders` + `new Set` + 2 `.filter()` | par image | 3×(w×h) + O(pages) | orchestrateur le plus coûteux | `splitOccludersFlat`, cache de coins, une seule mise à jour incrémentale | à vérifier |
| `hizOcclusion.ts:152-178` | `countUnoccluded` : par page, `projectBoxToScreen` (non caché, alloue `HizBounds`) + `hizRejects` | par page, par image | milliers | allocation + projection sans cache d'époque | `projectBoxesFlat` avec cache | à vérifier |
| `hizOcclusion.ts:37-81` | `hizTestRect` : recherche linéaire du mip (≤16) | par boîte, par image | 16 | linéaire | `clz32`/`log2` direct | faible |
| `hizSplit.ts:70-91` | `splitOccluders` : `.map` objets + `.sort` comparateur + 2 `.filter` — **utilisé en prod** | par image | pages | alors que `splitOccludersFlat` (20-67, radix 8 passes, zéro alloc) existe et n'est pas branché | brancher `splitOccludersFlat` dans `hizTemporal.ts` | à vérifier |
| `hizCorners.ts:9-89` | `worldCornersInto` (8 coins, 8 div) + `projectCornersInto` (8 coins, ~32 div) | par boîte, par image | 8 × N | recalcul intégral ; cache d'époque `createBoxCorners` (128-144) sous-utilisé | brancher le cache sur occlusion/split/temporal | à vérifier |
| `hizProjection.ts:65-92` | `projectBoxToScreen` : doublon non caché, alloue par appel | par page, par image | 1 objet/page | duplication | unifier vers `projectBoxesFlat` (12-61) | à vérifier |
| `gpuDagShader.ts:20-27` | WGSL `projected()` : `length()` + division | par cluster × 2 × jusqu'à 5 passes, GPU | — | 8-10 sqrt/cluster/image | comparer au carré | à vérifier |
| `gpuDagShader.ts:50-70` | `coneRejectsBox` : `asin` + `sin` + 2 `length` recalculés à chaque passe | par page × 4 passes, GPU | — | trig répétée | cacher `spread`/`axisWorld` dans `dagWanted` | à vérifier |
| `gpuDagShader.ts:124-181` | `dagWanted`, `dagEscalate`×3, `dagCheck`, `dagMask` : 5 relectures complètes de `pageCount` | par cluster, par image, GPU | pageCount × 5 | passes complètes | compaction entre rounds, fusion check+mask | à vérifier |
| `gpuDagRuntime.ts:94-101` | `updateResidency` : boucle sur toutes les pages comparant le flag résident | par image | dizaines de milliers | scan complet | mettre à jour seulement les pages changées | à vérifier |
| `gpuDagRuntime.ts:77-82` | `maxStretch` par monde modifié avec `Array.from(subarray)` | par image en mouvement | worldCount | allocation | passer la sous-vue | faible |
| `gpuDagUniforms.ts:46-49` | `parseDagOutput` : `push()` sur `pageCount` | par image (readback) | pageCount | push non pré-dimensionné | préallouer / n'itérer que `count` | à vérifier |
| `gpuHizTest.ts:35-59` | `createHizBoundsPacker` : par boîte, `hizTestRectFlat` scanne les niveaux | par page testée, par image, CPU | N × 16 | recherche linéaire | log2 direct | à vérifier |
| `gpuHizShader.ts:26-39` | `footprintFar` : 16×16 texels par boîte | par boîte, par image, GPU | 256 | scan brut | compromis mip déjà raisonnable | à vérifier |
| `gpuDagResources.ts:92-102` | `upload()` : `new Uint8Array(size)` par upload | chargement | taille DAG | copie intermédiaire | `writeBuffer` avec offset/longueur | nul |
| `gpuDagOracle*.ts`, `gpuHizOracle.ts` | oracles CPU miroirs (tests) | tests | — | — | ne pas toucher (comparaison bit à bit) | nul |

## sdk-browser : éclairage, visibilité logicielle, shaders (48 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `visibilityRaster.ts:15-64` | `fillIds` : raster logiciel, edge functions avec **division par l'aire à chaque pixel**, `bx-x` recalculés | par pixel couvert, par image | centaines/pixel × triangles | division par pixel | edge-function incrémentale (une division par triangle) | faible (ordre flottant) |
| `visibilityRaster.ts:67-135` | `rasterVisibility` : pages × triangles, `triangleAt`, culling arrière, test alpha ; l.133 passe pleine image `Infinity`→`HIZ_BACKGROUND` | par triangle, par image | VIS_MAX_PAGES × 256 | boucle chaude ; passe finale pleine image | remplir directement `HIZ_BACKGROUND` | faible |
| `visibilityShade.ts:9-34` + `visibilityShadePixel.ts:15-63` | shading CPU par pixel : reprojection du triangle (`triangleAt`), barycentrique, `visMaterial(page.material)` **alloué par pixel** | par pixel, par image (chemin CPU) | w×h | reprojection + allocation par pixel | cache triangle projeté ; `visMaterial` par page | nul |
| `visibilityMath.ts:9-48` | `triangleAt` : 3 `projectVisibilityVertex` | par triangle (raster) ET par pixel (shading) | 3 mat4 | recalcul redondant | cache par triangle | nul |
| `visibilityMath.ts:50-72` | `barycentric` + `perspectiveBary` : 2 divisions par pixel | par pixel | — | divisions | incrémental | faible |
| `visibilityMath.ts:74-126` | `attr2`, `wrapTexel`, `srgbToLinear` (`pow`), jusqu'à 6 cartes par pixel | par pixel | 6 | `pow` par canal par texel | LUT 256 sRGB ; pré-extraire les 3 sommets par triangle | nul |
| `visibilityMath.ts:128-130` | `clusterHash` : `Array.from(id).reduce` | par page | — | allocation | `charCodeAt` | nul |
| `visibilityTypes.ts:89-122` | `visMaterial` : objet + tableaux | par triangle et par pixel | — | allocation en boucle chaude | cache par matériau | nul |
| `visibilityShaderId.ts:30-42` | WGSL `computeTriangle` : bbox recalculée par les 3 invocations de sommet | par sommet | 3× | triple calcul | précalcul par triangle | nul |
| `sceneLightingShader.ts:5-23` | WGSL boucle sur **toutes** les lampes scène par pixel (non tuilée) + `standardLighting` | par pixel × lampes | ≤256 | non tuilé | tuiler comme `contractLighting` | à vérifier |
| `standardLighting.ts:4-30` | BRDF GGX (sqrt, pow) par lampe par pixel ; `inverseTranspose3` par pixel | par pixel × lampes | — | termes indépendants de la lampe recalculés | factoriser NdotV, alpha² ; matrice normale en uniforme | faible |
| `directLightingWgsl.ts:42-79` | PCF 16 prises par lampe ombrée par pixel | par pixel × lampes ombrées | 16 | 16 samples | LOD d'ombre | à vérifier |
| `gpuLightTilesShader.ts:90-101` | compaction sérielle mono-lane sur `count` lampes par tuile | par tuile, par image | ≤256 | 255 threads attendent | scan préfixe parallèle | nul |
| `lightingObservationUpdate.ts:59-97` | surfaces × rows × columns × 3 : `Number.isFinite` + écriture | par image | surfaces × patches × 3 | revalidation totale | delta | faible |
| `lightingRectangleBvh.ts:48-77` | `refit()` systématique | par image | 2n-1 | même sans mouvement | dirty flag | nul |
| `sceneLighting.ts:89-166` | `packSceneLights` : `instanceof` en cascade + `every(isFinite)` | par image | ≤256 | revalidation | cache du type | nul |
| `lightingObservationMeshes.ts:31-35` | filter imbriqué O(n×m) | chargement | ≤256 | — | — | nul |

## sdk-browser : webgpuPages{Encode,Render,State,Prepare,GpuCut}* (24 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `webgpuPagesEncodeShadows.ts:97-100` | double boucle couches × `BASE_SLOTS` pour compacter les slots non vides | par image (ombres) | centaines-milliers de slots | scan des vides | liste d'occupés incrémentale | nul |
| `webgpuPagesEncodeShadows.ts:109-129` | faces × slots : bind group + `drawIndirect` | par image | faces × slots | draw calls = produit | restreindre les slots par face | nul |
| `webgpuPagesRender.ts:32-35` | `camera.clone()` par image dès que la caméra bouge | par image | 1 caméra | clone profond pour comparer une pose | scratch position/quaternion/fov | nul |
| `webgpuPagesRender.ts:24-25` | recopie de toutes les matrices monde des racines opaques | par image | racines | copie inconditionnelle | révision | à vérifier |
| `webgpuPagesRender.ts:36-41` | `bounds.copy().applyMatrix4()` par mesh transparent | par image | meshes blend | 8 coins par image | sauter si matrixWorld inchangée | à vérifier |
| `webgpuPagesRenderCpu.ts:113,142` | `new Set([...bootstrap, ...desired.map(url)])` | par image (CPU) | milliers | map + 2 spreads + Set | Set persistant | nul |
| `webgpuPagesRenderCpu.ts:59,151,160` | `every`/`some`/`cache.get` sur shown/culled | par image | pages | parcours répétés | compteurs par événement | nul |
| `webgpuPagesEncodeBlend.ts:76` | `inverseViewProj.invert()` | par image | 1 mat4 | inversion même caméra figée | invalidation par révision | à vérifier |
| `webgpuPagesEncodeDraws.ts:74-77` | reconstruction `viewProj` + frustum | par image | 2 mat4 | recalcul | cache si caméra fixe | à vérifier |
| `webgpuPagesEncodeDraws.ts:84-95` | diagnostic `screen-error` : reprojection de toutes les pages | par image (diag) | milliers | — | — | nul |
| `webgpuPagesEncodeVis.ts:93-98`, `EncodeVisSetup.ts:24-29` | `.map()` → `colorAttachments` par image | par image | surfaces | allocation | cache jusqu'au resize | nul |
| `webgpuPagesEncoder.ts:61-77` | `reduce` triangles, `new Vector3`, `[...elements]` | par image échantillonnée | — | allocations | scratch | nul |
| `webgpuPagesGpuCut.ts:62-112` | 5 `appendAll` + 2 `keepOpaqueHead` | par image (GPU) | pages | parcours successifs | une passe | à vérifier |
| `webgpuPagesGpuCutAdmission.ts:10-11,100` | `triangleSum` recalculée | par image | pages | resommation | total incrémental | nul |
| `webgpuPagesPrepare.ts:23-44` | `prepareCones` : xyz entrelacé composant par composant | chargement | tous les sommets | écritures unitaires | `set`/`subarray` | nul |
| `webgpuPagesState*.ts` | allocations uniques (bon motif) | chargement | — | — | référence | nul |

## sdk-browser : webgpu* divers, visibilité, blend, rows, résidence (65 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `webgpuPagesPipelineFor.ts:22-36,58-79` | `windingCw` : déterminant 3×3 par page, jamais caché sur `PageRec` | par page, par image (chemins de secours + `visBin`) | drawSlots | recalcul par image | cache sur `PageRec`, invalidé dans `setWebgpuTransform` | à vérifier |
| `webgpuBlendDraw.ts:65-66` | `item.matrix.determinant()` **deux fois** (front/back) | par item transparent, par image | items | duplication | une fois | nul |
| `webgpuBlendUniforms.ts:28` | `Math.hypot(1,3,2)` constante recalculée par image | par image | 1 | sqrt constante | `Math.sqrt(14)` littéral | nul |
| `webgpuBlendUniforms.ts:29-79` | ~30 champs d'uniforme réécrits par item par image | par image | items | écriture même sans changement | dirty par item | à vérifier |
| `webgpuBlendSelection.ts:19-23` | parcourt toutes les pages dessinées pour ne garder que les transparentes | par image | drawn | balayage complet | liste séparée | à vérifier |
| `webgpuBlendSelection.ts:48` | `cut.sort` par mesh transparent à chaque changement de cut | par changement | k log k | tri | test « déjà trié » | à vérifier |
| `webgpuRowCommit.ts:91-98` | boucle finale réécrit 4 tableaux pour **toutes** les lignes après `commitRows` | par image (table changée) | drawSlots | réécriture intégrale | seulement lignes déplacées/reconstruites | à vérifier |
| `webgpuRowSync.ts:36-62` | `syncRows` : balaie **tout le catalogue** de pages quand la résidence change | par image (dirty) | toutes les pages | O(catalogue) | itérer sur le delta du mirror | à vérifier |
| `webgpuRowSync.ts:76-96` | `pageIndexByRec.get(rec)` Map objet→index par page | par image (CPU) | drawn | hash lookup | champ direct sur `PageRec` | à vérifier |
| `webgpuVisibilityItems.ts:30-53` | par ligne : `visBin` (windingCw) + copie de `HIZ_BOUNDS_VALUES` élément par élément | par image | drawSlots | copie unitaire | `set(subarray)` | à vérifier |
| `webgpuVisibilityDrawer.ts:91-98` | fallback non-indirect : un `pass.draw()` + `visPipelineFor` par cluster | par image (fallback) | milliers | draw par cluster | cache winding ; batching | à vérifier |
| `webgpuFallbackDraw.ts:21-75` | fallback : uniforme 256 o par page + un draw par page | par image (fallback) | drawSlots | pas de batching ; réécriture | dirty rows ; draw indirect | à vérifier |
| `webgpuPagesHelpers.ts:64-86` | `shownFromGpu` : somme triangles + `uncovered` sur tout `ids` | par image (adoption) | milliers | recalcul intégral | delta `entered/exited` | à vérifier |
| `webgpuResidencySets.ts:160-177` | `applyBudget` : `capScratch.sort` par image en surcharge | par image (budget dépassé) | k log k | tri complet | sélection partielle | à vérifier |
| `webgpuResidentEnsurer.ts:56-75`, `webgpuBootstrap.ts:90-96` | `await cache.load()` séquentiel | par job / démarrage | pages | sérialisation | parallélisme borné | nul |
| `webgpuPinUpdater.ts:76-85` | 2 `Set<string>` neufs par image pendant éviction différée | par image (transition) | keep.count | allocations | reconstruire seulement si `deferredDrops` a changé | nul |
| `webgpuPagesHostApi.ts:79-83` | `drawnOpaquePages` : clone de chaque `PageRec` | à la demande | pages | spread par page | typage | à vérifier |
| `webgpuPagesMetrics.ts:8-17` | resomme `vertexBytes` par appel | par image (métriques) | buffers | recalcul | compteur | nul |
| `webgpuPagesTransform.ts:36-56` | `source.traverse` pour trouver un nœud | par `setTransform` | nœuds | traversal | Map nom→nœud | nul |
| `webgpuVisibilityUniforms.ts:30-42` | `viewProj` copiée par slot | par image | couches+1 | 16 floats × slots | `copyWithin` | nul |
| `webgpuCutDelta.ts:52-70`, `webgpuKeyUnion.ts:65-82` | détection des sorties : balaye tout l'ensemble tenu | par image | cut précédent | inhérent au diff par estampille | acceptable | nul |
| `webgpuPageRow.ts:51-138` | ~40 champs + `assertVisibilityPageTriangles` à chaque écriture de ligne | par ligne changée | — | assertion en prod | limiter au mode dev | nul |

## sdk-browser : lots de clusters (clusterBatch*), pages, réplication

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `clusterBatchUpdate.ts:29-53` | boucle principale par page affichée : `groupForPage`, index URL, slot, `DrawRanges.push`, compteur triangles, ou `pending` si transparent | **par image, par cluster visible** | milliers | pas d'allocation ; volume d'itérations | inlining ; ne pas toucher l'ordre ni les `continue` | à vérifier |
| `clusterBatchUpdate.ts:55-72` | groupes transparents : test « déjà trié » puis `pending.sort(bySourceOrder)` | par image, par groupe transparent | pages en attente | tri complet O(n log n) quand l'ordre change | tri par insertion sur la portion désordonnée | à vérifier (ordre de blending) |
| `clusterBatchUpdate.ts:84-116` | par groupe touché : `mesh.matrix.copy` (16 flottants) même si inchangée, multiDraw arrays, `flush()` | par image, par groupe | petit | copie inutile | mémoriser si `sample.matrix` a changé | nul |
| `clusterBatchRange.ts:96-126` | `DrawRanges.push` : fusion avec la plage précédente (calcul en octets) sinon append (doublement Int32Array) | par cluster affiché, par image | milliers | `offset*BYTES_PER_ELEMENT` recalculé ; sans allocation en cas commun | précalculer les octets ; le gain réel est la fréquence d'appel | à vérifier (égalité stricte des offsets) |
| `clusterBatchRange.ts:44-56` | `IndexRangeAllocator.allocate` first-fit linéaire | par page résidente (streaming) | nb plages libres (fragmentation) | O(n) par allocation | structure triée / index par taille | à vérifier (offsets seulement) |
| `clusterBatchRange.ts:58-82` | `release` : recherche linéaire d'insertion + fusion voisins | par page évincée | nb plages libres | O(n) | structure ordonnée | nul |
| `clusterBatchLayers.ts:53-64` | `groupForPage` : `Map.get` si `depthLayer>0` | par cluster affiché, par image | O(1) × milliers | Map.get cas rare | déjà optimisé | à vérifier |
| `clusterBatchPrimitive.ts:56-71` | `reserve()` + `growTo` (recopie complète du Uint32Array) | par page résidente | O(1) amorti sauf growTo | recopie complète si capacité dépassée | pré-dimensionner la capacité | à vérifier |
| `clusterBatchPrimitive.ts:92-101` | `flush()` : `addUpdateRange` par plage en attente | par image, par primitive touchée | petit | — | — | nul |
| `clusterBatches.ts:127-140` | `markUrls()` : dédup par timbre entier, `into.push` | par changement de coupe | pages de la coupe | push sans préallocation | préallouer | nul |
| `clusterBatchSetup.ts:38-151` | construction des lots : drafts, Map URL→index, bbox, groupes, split double-face, shader hooks | compilation / reconstruction | toutes les pages | one-shot | — | nul |
| `clusterPages.ts:12-15` | `digest()` SHA-256 → hex via Array.from + padStart | par page chargée | 32 | allocation + concat par octet | table hex | nul |
| `replicateInstances.ts:20-31` | triple boucle rows×cols×meshes : clone Mesh + copie matrice + décalage | setup | ≤ 12 × meshes | allocation d'objets Mesh | InstancedMesh (architecture) | à vérifier (décalage bit à bit) |

## sdk-browser : pages annexes + streaming

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `pageCone.ts:16-27` | Produit vectoriel de face | par triangle | 2× par triangle | recalculé deux fois (axe moyen puis angle max) | un seul passage, mémoriser les cross-products | à vérifier |
| `pageCone.ts:30-58` | Cône de normales d'un cluster (axe + acos) | par cluster, compilation | 32-128 tri | double parcours, hypot/acos | fusionner les deux boucles | faible |
| `pageCone.ts:91-131` | Rejet de cône (matrice normale, spread, dot) | par page candidate, par image | 1 page × clusters candidats | `getNormalMatrix(world)` inversion à chaque appel | cache par mesh tant que la matrice monde ne change pas | faible |
| `pageRaster.ts:9-25` | Remplissage RGBA (oracle tests) | par image (tests) | w×h | pixel par pixel | vue Uint32Array | nul |
| `pageRaster.ts:37-92` / `95-121` | Projection + raster logiciel (tests) | tests | nb tri | `scene.traverse` refait la liste des meshes | cache | nul |
| `pageRaster.ts:163-190` | Barycentrique pixel par pixel (tests) | tests | bbox | 3 divisions par pixel | `invArea` | nul |
| `pagesBackendFixture.ts:3-63` | Fixtures de test | tests | — | spreads, `.map` | non pertinent | nul |
| `geometryPage.ts:65-68` | Indices 16 bits → Uint32Array | par indice, chargement page | dizaines de milliers | `DataView.getUint16` élément par élément | vue Uint16Array + copie bloc (endianness) | à vérifier |
| `geometryPage.ts:72-88` | Décodage attributs sommets (jusqu'à 18 floats) | par sommet, chargement page | jusqu'à 65535 × 18 | closure `read` réallouée par sommet (l.75), DataView float par float | sortir la closure, Float32Array vue | faible |
| `arrivalQueue.ts:45-64` | Drain des arrivées, dédup `touched.includes` | par page, par image | countBudget | recherche linéaire | Set | nul |
| `streamingCache.ts:14-53` | Éviction LRU | par page admise | cache.size | parcours avec `continue` sur pinned/jobs | file de candidats | nul |
| `streamingFetch.ts:4-7` | SHA-256 → hex | par page | 32 | Array.from + join | table hex | nul |
| `streamingPages.ts:151` | Dédup urls | par lot | nb urls | filter + Set | boucle unique | nul |
| `streamingPriority.ts:27-34` | Mat4 × Mat4 triple boucle | par matrice distincte, par image | 64 mult | `Map` cache `views` recréée à chaque appel | cache inter-image | à vérifier |
| `streamingPriority.ts:81-126` | Erreur écran + distance par cluster non résident, agrégés par bundle `Map<string,Slot>` | par cluster, par image (streaming) | centaines-milliers | Map à clé chaîne recréée | Map persistante `.clear()` | nul |
| `streamingPriority.ts:128` | Tri des bundles | par image | nb bundles | spread + sort | — | nul |
| `streamingQueue.ts:22-59` | `pump()` admission des jobs | par page, rafales | centaines | **`queue.sort` relancé à chaque itération du while** + findIndex + splice → O(k·n log n) | trier une fois, index ou tas | nul |
| `streamingQueue.ts:118-149` | Retrait requête annulée | par annulation | queue.length | indexOf + splice | index url→position | nul |

## sdk-browser : explorer*, autonomous*

| Fichier:lignes | Ce que ça calcule | Fréquence | Taille typique | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|---|
| `autonomousGeometry.ts:54-64` | `sync` : `new Set(display)` **alloué par image**, détache/attache, somme triangles | par image | milliers | Set par image | Set scratch ou compteur d'image | nul |
| `autonomousGeometry.ts:39-53` | `attach` : `mesh.matrix.copy(rec.matrix)` pour chaque page affichée | par image, par page | milliers | copie inconditionnelle | dirty flag | à vérifier |
| `autonomousGeometry.ts:70-90` | `removeRecords` : 4 listes × `splice` en boucle | à la demande | n × 4 | quadratique | `filter` en une passe | nul |
| `autonomousGeometry.ts:91-165` | `storeGeometryPage` : validation par sommet contre bornes (epsilon 1e-5) | par page chargée | 3×sommets | garde-fou voulu | conserver | nul |
| `autonomousInstances.ts:76-86` | `updateInstance` : `new Map(basePages.map(...))` **à chaque appel** + mat4×mat4 par page | potentiellement par image (instance animée) | racines + pages | Map reconstruite | mapping stocké dans l'instance | à vérifier |
| `autonomousInstances.ts:39-75` | `addInstance` : clone géométrie + `transform.clone().multiply` par page | à la demande | pages × racines | clone par page | regrouper | nul |
| `autonomousInstances.ts:96-117` | `updateMaterial` : `allPages.filter(startsWith/includes)` | à la demande | toutes les pages | scan + chaînes | index par primitive | nul |
| `autonomousPages.ts:127-155` | `render` : `updateMatrixWorld(true)` toute la scène, `desired.push(...wanted)` spread, `sync()` | par image | milliers | spread dans push (limite d'arguments, lent) | boucle `for` | à vérifier |
| `autonomousPages.ts:168-182` | `metrics` : `allPages.filter(rec => !!rec.array).length` | par image | dizaines de milliers | scan complet pour un comptage | compteur incrémental | nul |
| `autonomousResidency.ts:24-29` | `pendingUrls` : `!pending.includes(url)` en boucle → O(n²) | par image | desired.length | includes en boucle | Set | nul |
| `autonomousResidency.ts:30-37` | `pageUrls` : `new Set([...bootstrap, ...modified])` + spread final, par image | par image | milliers | Set + 3 spreads par image | Set scratch persistant | nul |
| `explorerRender.ts:83-84` | `backends.find()` ×2 par image en mode comparaison | par image | 2-4 | recherche par image | cache au `setComparison` | nul |
| `explorerDraw.ts:26-71` | `missing.filter`, `ring.filter().slice(0,PREFETCH_BATCH)` | par image (throttlé) | dizaines à anneau complet | filter avant slice | boucle avec break | nul |
| `explorerScene.ts:11-37` | `exactPagesBounds` : `primitives.find` par mesh + Box3/Vector3 par page | chargement | meshes × primitives | O(M×P) + allocations | Map + scratch | nul |
| `explorerPageSources.ts:20-49` | `flatMap` des pages refait 3-4 fois | chargement | milliers | parcours répétés | un seul parcours | nul |
| `explorerCapabilities.ts:164-173` | mesh × matériau × `Object.values` (anisotropie) | chargement optionnel | milliers | allocation par matériau | Set de textures | nul |
| `explorerSceneApi.ts:72-89` | `renderViews` : `rgba.slice()` par vue | par vue | résolution | copie redondante | buffer de sortie | à vérifier |
| `explorerLifecycle.ts:91-112` | `awaitPages` : `await` séquentiels | à la demande | moteurs × pages | pas de Promise.all | paralléliser | nul |

## sdk-browser : gpuDraw*, gpuPage*, exactPages*, télémétrie (45 fichiers)

| Fichier:lignes | Ce que ça calcule | Fréquence | Motif coûteux | Idée d'optimisation | Risque image |
|---|---|---|---|---|---|
| `exactPagesRender.ts:72` + `exactPagesRequests.ts:111-127` | `selectVisiblePages` appelé **deux fois par image** (rendu, puis `prefetchUrls` au seuil moitié) | par image | second parcours complet du DAG | dériver le prefetch de la première passe ou le throttler | à vérifier |
| `gpuDrawShader.ts:57-77` | WGSL `prefixGroups` : scan préfixe séquentiel `@workgroup_size(1)` | par image, GPU | un seul thread | scan parallèle par slot | nul |
| `gpuSmallTrianglesShader.ts:50-69` | `setupTriangle` : déterminant 3×3 par triangle, ne dépend que de la page | par triangle, GPU | recalcul | hisser par page | nul |
| `gpuPageCommit.ts:28-34` | balayage linéaire de la `Map` résidente à chaque éviction | par éviction | O(pages) | index LRU | nul |
| `telemetry.ts:24-33` | `Array.shift()` par image | par image | O(n) | tampon circulaire (comme `cpuProfile.ts`) | nul |

## Top 15 des boucles chaudes (fréquence × taille, par image sauf mention)

| # | Fichier:lignes | Pourquoi c'est chaud | Risque |
|---|---|---|---|
| 1 | `sdk-browser/hizDepth.ts:25-84` (`visibilityDepth`) | par pixel (≈921 600 à 720p) ; reprojette 3 sommets par pixel au lieu de par triangle | nul si bit-exact |
| 2 | `sdk-browser/visibilityRaster.ts:15-64` (`fillIds`) | par pixel couvert ; division par l'aire à chaque pixel | faible (ordre flottant) |
| 3 | `sdk-browser/visibilityShadePixel.ts:15-63` + `visibilityTypes.ts:89-122` | par pixel ; reprojection + allocation `visMaterial` par pixel | nul |
| 4 | `sdk-browser/hizTemporal.ts:37-104` (`applyTemporalHiz`) | jusqu'à 3 rasters plein écran + 2 pyramides + tri d'occludeurs non optimisé | nul (brancher `splitOccludersFlat`) |
| 5 | `sdk-browser/hizDepth.ts:9-17` (`rowsOf`) | plein écran → `number[][]` à chaque pyramide | nul |
| 6 | `sdk-browser/pageSelectionCutVisit.ts:60-136` + `pageSelectionMath.ts` | par nœud du DAG, milliers/image ; sqrt + boxClip branché ; appelé 2× par image (`exactPagesRequests.ts:111`) | nul à à vérifier |
| 7 | `sdk-browser/hizOcclusion.ts:152-178` (`countUnoccluded`) | par page ; projection sans cache + allocation | nul |
| 8 | `sdk-browser/gpuDagShader.ts:124-181` | GPU : 5 relectures de `pageCount`, `asin`/`sin` répétés | à vérifier |
| 9 | `sdk-browser/gpuDagRuntime.ts:94-101` (`updateResidency`) | CPU : tout `pageCount` par image | nul |
| 10 | `sdk-browser/clusterBatchUpdate.ts:29-72` + `clusterBatchRange.ts:96-126` | par cluster visible ; tri transparents | à vérifier (ordre de blending) |
| 11 | `sdk-browser/webgpuRowSync.ts:36-62` + `webgpuRowCommit.ts:91-98` | tout le catalogue / toutes les lignes réécrites | nul |
| 12 | `sdk-browser/autonomousResidency.ts:24-37` + `autonomousPages.ts:168-182` | O(n²) `includes`, `new Set` + spreads, `filter().length` par image | nul |
| 13 | `sdk-browser/webgpuPagesPipelineFor.ts:22-36` (`windingCw`) + `webgpuBlendDraw.ts:65-66` | déterminants recalculés par page/item par image | nul |
| 14 | `sdk-core/lightingTransportVisibility.ts:53-133` + `lightingTransportSolve.ts:24-100` | patch × rayon × surface, Jacobi dense O(n²×it) | à vérifier (éclairage) |
| 15 | `rust dag/groups.rs:125-134` → `qem.rs` + `import/mesh.rs:39-101` | compilation : QEM (meshopt) et dédup des coins, millions d'itérations | à vérifier / nul |

## Harnais existants

- `scripts/mesure/banc.mjs` (+ `serie.mjs`, `page.mjs`, `rapport.mjs`, `options.mjs`, `serveur.mjs`) : banc navigateur WebGL/WebGPU, avant/après, `--cache-avant`/`--cache-apres`. Commande : `node scripts/mesure/banc.mjs` (voir `scripts/mesure/README.md`).
- `packages/asset-compiler-rust/src/perf.rs` : chronomètres par phase, sortie JSON du compilateur (`npm run build:native` puis exécution du binaire).
- Aucun `cargo bench`, aucun fichier `*.bench.*`, aucun micro-banc JS : à créer pour le comparatif fonction par fonction.
