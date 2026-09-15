# Audit des calculs, lot G — Rust natif et sdk-core (15 septembre 2026)

Passage global de vérification demandé par l'utilisateur, sur `develop` après les lots A à F.
Périmètre : `packages/asset-compiler-rust/src/**/*.rs` (hors tests et `bench_calculs/`) et
`packages/sdk-core/*.ts` (hors tests et `bench/`) — lecture intégrale, fichier par fichier.
Recherche de calculs refaits sur entrées inchangées, d'allocations en boucle chaude, de tris ou
recherches linéaires en boucle, de conversions répétées, de parcours complets là où un delta existe,
et d'optimisations d'un lot précédent défaites ou non étendues par un lot ultérieur. Exclu d'avance :
tout ce qui changerait l'ordre des sommations flottantes (`plane_of_triangles`, `same_plane`,
`groups.rs`, `surface.rs`, `merge_spheres`/`enclosing_sphere`, `cover()`).

Seuls des points **nouveaux** (absents de `AUDIT_MATH_INVENTAIRE.md` et des tableaux
`calculs-2026-09-15.md`, `calculs-c-2026-09-15.md`, `calculs-f-2026-09-15.md`,
`calculs-natif-2026-09-15.md`) ou **défaits** figurent ci-dessous.

| Fichier:lignes | Ce que ça calcule | Fréquence | Motif | Changement proposé | Pourquoi le résultat est identique | Gain attendu |
|---|---|---|---|---|---|---|
| `compiler_plan.rs:81-83` + `compiler_accessor_create.rs:3-4` + `compiler_primitive.rs:46-55,60-64,126` | Validation d'un accessor (`accessor_validation::validate`) | à la compilation, une fois par accessor distinct dans `plan_buffers`, puis **une seconde fois** par usage dans `compile_primitive` (POSITION, indices, jusqu'à 5 attributs nommés) | calcul refait sur entrées inchangées : `plan_buffers` a déjà validé chaque id d'accessor une fois (ensemble dédupliqué), `accessor()` revalide le même id à chaque lecture | ajouter un paramètre (ou une passe préalable qui construit `Accessor` une fois et le fait circuler) pour que `accessor()` ne revalide pas un id déjà validé par `plan_buffers` | `g`, `bin` et `id` sont strictement les mêmes aux deux appels ; `validate()` est une fonction pure sans effet de bord, donc sauter le second appel ne change aucune valeur ni aucune erreur possible (l'erreur, si elle existe, a déjà été levée à la première validation) | faible |
| `manifest_binary/primitive.rs:40-45,79-93` + `manifest_binary/page.rs:73-88,138-149` | Étiquette d'erreur (`&format!(...)`) passée à `number()`/`integer()` pour chaque nombre écrit dans une colonne (nœuds de culling, membres de groupe, clés `page.{group,source}`, `page.geometry.{key}`) | par nœud de culling et par membre de groupe (`primitive.rs`, potentiellement des dizaines de milliers par primitive) ; par page × 2 ou 5 clés (`page.rs`, dizaines de milliers de pages) | allocation en boucle chaude : une `String` est formatée à **chaque itération**, alors qu'elle ne sert qu'au chemin d'erreur ; c'est exactement le motif que le lot B a corrigé dans `format.rs::vector_into` (commentaire : « le nom de l'entrée fautive n'est construit que lorsqu'il y en a une »), mais qui n'a pas été étendu aux autres appels de `number`/`integer` du même fichier | ne construire le `format!(...)` que dans la branche d'erreur (ex. `number(Some(node), "").map_err(\|_\| bad(format!(...)))`, ou une variante de `number`/`integer` prenant un contexte + index et ne formatant qu'à l'échec) | le message d'erreur, construit uniquement quand il y a une erreur, est identique à l'actuel ; les octets écrits en cas de succès ne dépendent pas de cette chaîne | moyen (primitive.rs, nœuds de culling) / faible (page.rs) |
| `compiler_primitive_dag.rs:55-70` | `level_stats` : `errors.sort_by(f64::total_cmp)` puis lecture de `errors[0]`, `errors[len/2]`, `errors[len-1]` pour `errorMin`/`errorMedian`/`errorMax` | une fois par niveau du DAG (≤ 32), par primitive — `errors.len()` peut être plusieurs milliers au niveau 0 | tri complet O(n log n) pour n'extraire que trois statistiques d'ordre (min, médiane, max) | remplacer le tri par un `select_nth_unstable_by` sur l'indice `len/2` (le min et le max s'obtiennent par un simple parcours ou par les bornes renvoyées par la partition), sans toucher à l'ordre dans lequel `dag`/`tallies` sont ensuite utilisés | `total_cmp` est un ordre total ; une sélection partielle (quickselect) rend exactement le même élément à un rang donné qu'un tri complet — les trois valeurs publiées dans le rapport sont bit à bit identiques, seul le nombre de comparaisons change | faible |
| `texture_preview/reduce.rs:12-26` (`pyramid`) + `manifest_binary/preview.rs:31-45` | `preview_pixel_bytes(width, height)` recalcule `preview_first_level` et `preview_last_level` en interne, alors que l'appelant vient de calculer `first`/`last` (`reduce.rs:14-17`) ou `first` seul (`preview.rs:31`) avec les mêmes `width`/`height` | une fois par texture couleur décodée, à la compilation | calcul refait sur entrées inchangées : deux à trois appels à des fonctions en boucle bornée (`preview_first_level` boucle jusqu'à 31 fois) pour le même résultat déjà en main dans la fonction appelante | ajouter une variante interne (`preview_pixel_bytes_between(first, last, width, height)`, ou factoriser la somme des niveaux) prenant `first`/`last` déjà connus, et l'utiliser depuis `pyramid()` et `preview.rs` | `preview_first_level`/`preview_last_level` sont des fonctions pures de `(width, height)` seuls ; leur donner le résultat déjà calculé au lieu de le refaire ne change aucune valeur | faible |
| `manifestBinaryPreview.ts:19-25` (`expectedGeometry`) | `previewFirstLevel(width,height)` appelée directement, puis `previewLevelCount(width,height)` (qui rappelle `previewLastLevel`+`previewFirstLevel`), puis `previewPixelBytes(width,height)` (qui rappelle encore `previewLastLevel`+`previewFirstLevel`) | par entrée de texture preview, au décodage (`decodeTexturePreviews`, une fois par entrée) **et** à l'encodage (`encodeTexturePreviews`, `forEach`) — miroir exact de la redondance Rust ci-dessus, mais avec un niveau d'imbrication de plus | `previewFirstLevel` est calculé 3 fois et `previewLastLevel` 2 fois par appel à `expectedGeometry`, sur les mêmes `width`/`height` | calculer `first = previewFirstLevel(width,height)` et `last = previewLastLevel(width,height)` une seule fois dans `expectedGeometry`, puis dériver `levelCount = last - first + 1` et sommer `previewLevelSize` sur `[first, last]` sans repasser par les fonctions publiques | fonctions pures du seul couple `(width, height)` ; factoriser ne change aucune des trois valeurs retournées (`firstLevel`, `levelCount`, `pixelBytes`), qui restent comparées bit à bit aux mêmes valeurs déclarées dans le sidecar | faible |
| `sceneLightSunCascades.ts:17-29` (`sunCascadeSplits`) et `:70-93` (`sunCascadeOf`, appelée depuis `sceneLightSunFaces.ts:35` puis `sceneLightShadowFaces.ts:71`) | Table des `count+1` bornes de cascade (`Math.pow(far/near, ratio)` par borne) | recalculée **à chaque face** d'une lampe directionnelle (`sunCascadeOf` est appelée une fois par cascade dessinée, jusqu'à `LIGHT_SETTINGS.sunCascades` = 4 fois par image pour le soleil), alors qu'elle ne dépend que de `view` (near/far/aspect/fovY), identique pour toutes les faces de la même image | calcul refait sur entrées inchangées : la commande « la cascade n'est calculée qu'une fois pour les deux écritures » (commentaire de `writeSunFace`) ne couvre que la réutilisation à l'intérieur d'un seul appel de face, pas entre les faces d'une même image ; `sceneLightShadowChanges.ts` tient déjà un `viewEpoch`/`noteView` qui détecte un changement de vue sur les mêmes 9 nombres, mais `sunCascadeOf` ne s'en sert pas | mémoriser `splits` avec la dernière vue utilisée (comparaison des mêmes champs que `noteView`, ou un cache tenu par l'appelant et passé à `sunCascadeOf`), et ne rappeler `sunCascadeSplits` que si la vue a changé depuis la dernière face | `sunCascadeSplits` est une fonction pure de `view` (near, far, aspect, halfFovY, `sunCascadeLambda`, `sunShadowFarFraction`) ; recalculer moins souvent pour la même vue ne change aucune des bornes ni, en aval, aucune matrice ou boîte de cascade | faible à moyen (jusqu'à 4× moins d'appels à `Math.pow` par image sur les images qui redessinent le soleil) |

## Vérifié conforme

Fichiers lus en entier, rien à signaler au-delà de ce qui figure déjà dans `AUDIT_MATH_INVENTAIRE.md`
ou dans les tableaux `calculs-*.md` (points déjà retenus, déjà refusés avec preuve, ou déjà
« nul »/« à vérifier » et non touchés par ce lot) :

**Rust — `packages/asset-compiler-rust/src`** : `accessor_validation.rs`, `cli_batch.rs`,
`compiler_accessor_decode.rs`, `compiler_accessor_types.rs`, `compiler_args.rs`,
`compiler_autonomous.rs`, `compiler_buffers.rs`, `compiler_build.rs`, `compiler_bundles.rs`,
`compiler_coplanar.rs`, `compiler_copy.rs`, `compiler_format.rs`, `compiler_materials.rs`,
`compiler_nodes.rs`, `compiler_primitive_bundle.rs`, `compiler_prune.rs`, `compiler_ratio.rs`,
`compiler_runtime.rs`, `compiler_scene.rs`, `compiler_source.rs`, `compiler_storage.rs`,
`compiler_types.rs`, `compiler_validate.rs`, `compiler_world.rs`, `coplanar.rs`, `coplanar/assign.rs`,
`coplanar/groups.rs`, `coplanar/overlap.rs`, `coplanar/pairs.rs`, `coplanar/placement.rs`,
`coplanar/plane.rs`, `coplanar/report.rs`, `coplanar/surface.rs`, `dag.rs`, `dag/bounds.rs`,
`dag/build.rs`, `dag/clusters.rs`, `dag/culling.rs`, `dag/groups.rs`, `geometry_page.rs`, `import.rs`,
`import/lighting.rs`, `import/materials.rs`, `import/mesh.rs`, `import/runner.rs`, `import/scene.rs`,
`import/textures.rs`, `lib.rs`, `main.rs`, `manifest_binary.rs`, `manifest_binary/digests.rs`,
`manifest_binary/format.rs`, `manifest_binary/page.rs` (hors la ligne signalée ci-dessus),
`manifest_binary/preview.rs` (hors la ligne signalée ci-dessus), `perf.rs`, `qem.rs`,
`texture_preview.rs`, `texture_preview/collect.rs`, `texture_preview/levels.rs`,
`texture_preview/reduce.rs` (hors la ligne signalée ci-dessus), `texture_preview/source.rs`,
`topology.rs`, `topology/link.rs`.

**sdk-core — `packages/sdk-core`** : `cacheContracts.ts`, `competitors.ts`, `contracts.ts`,
`contractsBase.ts`, `depthLayer.ts`, `diagnostics.ts`, `events.ts`, `geometryContracts.ts`,
`hizOracles.ts`, `hizPyramidFlat.ts`, `index.ts`, `jobs.ts`, `lightingExperimentScene.ts`,
`lightingSceneControls.ts`, `lightingSceneGeometry.ts`, `lightingSceneGltf.ts`,
`lightingSceneGltfBuffer.ts`, `lightingSceneMath.ts`, `lightingSceneObjects.ts`,
`lightingSceneRooms.ts`, `lightingSceneSphere.ts`, `lightingSceneTypes.ts`, `lightingTransport.ts`,
`lightingTransportContracts.ts`, `lightingTransportGeometry.ts`, `lightingTransportIntersections.ts`,
`lightingTransportOracle.ts`, `lightingTransportRays.ts`, `lightingTransportResidual.ts`,
`lightingTransportSolve.ts`, `lightingTransportState.ts`, `lightingTransportValidation.ts`,
`lightingTransportVisibility.ts`, `lodPolicy.ts`, `manifestBinary.ts`, `manifestBinaryDecode.ts`,
`manifestBinaryDecodeParts.ts`, `manifestBinaryEncode.ts`, `manifestBinaryFormat.ts`,
`manifestBinaryLayout.ts`, `manifestBinaryPreview.ts` (hors la ligne signalée ci-dessus),
`manifestBinaryRead.ts`, `manifestBinaryTypes.ts`, `metricsContracts.ts`, `oracles.ts`, `paths.ts`,
`projectionOracles.ts`, `safety.ts`, `sceneLightContracts.ts`, `sceneLightShadowAtlas.ts`,
`sceneLightShadowChanges.ts`, `sceneLightShadowFaces.ts`, `sceneLightShadowMath.ts`,
`sceneLightShadowPlan.ts`, `sceneLightShadowSlices.ts`, `sceneLightStore.ts`,
`sceneLightSunFaces.ts` (hors l'appel signalé ci-dessus), `sceneLightValidate.ts`, `stageProfile.ts`,
`stats.ts`, `texturePreviewLevels.ts` (hors la ligne signalée ci-dessus).
