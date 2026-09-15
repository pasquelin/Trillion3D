# Formules communes, lot Rust — 2026-09-15

Commit `2e62aa2` · rustc 1.98.1 (48a229cea 2026-09-01) · release --locked · Darwin 27.0.0 arm64 ·
médiane sur au moins 50 tours ou 2 s, référence et version commune alternant tour par tour.
Bancs d'équivalence : `cargo test --release bench_calculs -- --ignored` (lignes F1 à F7), entrées
empoisonnées de `bench_calculs/f_valeurs.rs` — NaN, ±∞, ±0, dénormalisées, `f64::MAX`, boîtes
retournées. Portes : `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test` (167 + 4 verts, dorées `coplanar_golden.rs` et `apercus_golden.rs` comprises),
`npm run check:lines`, `npm run check:duplicates` (0 clone).

## Doublons factorisés

| Doublon                                    | Nom générique                    | Fichier commun       | Sites remplacés                                                                                                                                                                                                                   | Identique (oui/non) | Retenu (oui/non) |
| ------------------------------------------ | -------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- |
| Boucle AABB min/max sur un point           | `extend_aabb`                    | `src/shared_math.rs` | `dag/bounds.rs::bounding_sphere`, `dag/bounds.rs::cluster_bounds`, `coplanar/placement.rs::extend_box`, `coplanar/overlap.rs::rectangle` (2D), `compiler_primitive_bundle.rs::bundle_dag_pages`, `proxy/bvh.rs::extent` (6 sites) | oui (F1)            | oui              |
| Boucle AABB min/max sur une boîte          | `merge_aabb`                     | `src/shared_math.rs` | `dag/culling.rs` (2 blocs, fondus dans `node_bounds`)                                                                                                                                                                             | oui (F2)            | oui              |
| Boucle AABB min/max en `f32`               | `extend_aabb_f32`                | `src/shared_math.rs` | `import/mesh.rs::mesh_json`, `proxy/bvh.rs::bounds_of` (2 sites)                                                                                                                                                                  | oui (F3)            | oui              |
| Axe le plus long + coupe médiane triée     | `longest_axis`, `bisect_centres` | `src/shared_math.rs` | `dag/culling.rs::build_culling_bvh`, `dag/groups.rs::group_clusters` (2 sites)                                                                                                                                                    | oui (F4)            | oui              |
| Bornes d'un nœud de la hiérarchie de rejet | `node_bounds`                    | `src/dag/culling.rs` | `dag/culling.rs` (2 blocs identiques de 19 lignes)                                                                                                                                                                                | oui (F2)            | oui              |
| Bourrage à quatre octets `(4 − x % 4) % 4` | `pad_to_4`                       | `src/shared_math.rs` | `compiler_buffers.rs`, `compiler_copy.rs`, `import.rs::Bin::view`, `compiler_autonomous.rs` (boucle `while` équivalente) (4 sites)                                                                                                | oui (F5)            | oui              |
| Normalisation gardée à 1e-12               | `normalized_or`                  | `src/shared_math.rs` | `import/lighting.rs::light_matrix` (repli `−Z`), `import/mesh.rs::mesh_json` (repli `+Y`) (2 sites)                                                                                                                               | oui (F6)            | oui              |
| Secondes → millisecondes `×1000`           | `elapsed_ms`                     | `src/shared_math.rs` | `compiler_build.rs` (3), `main.rs` (2), `cli_batch.rs`, `import/scene.rs` (2), `import/runner.rs` (2) (10 sites)                                                                                                                  | oui (F7, hors banc) | oui              |

Total : 28 copies remplacées par 8 exemplaires uniques. `merge_aabb` porte la formule et
`extend_aabb` l'appelle avec le même point deux fois : le coin bas n'est comparé qu'au coin bas,
donc aucune comparaison de plus, qui trancherait autrement entre `+0.0` et `−0.0`.

## Mesures d'équivalence

| Banc                                                                    | Avant (ms) | Après (ms) | Écart  | Identique |
| ----------------------------------------------------------------------- | ---------- | ---------- | ------ | --------- |
| F1 boîte d'un nuage de points (200 000 points, 1/7 empoisonné)          | 0.143      | 0.139      | +2.8 % | oui       |
| F2 boîte de boîtes (200 000 boîtes, 1/11 retournée)                     | 0.177      | 0.178      | −0.1 % | oui       |
| F3 boîte en simple précision (200 000 points)                           | 0.067      | 0.067      | −0.0 % | oui       |
| F4 coupe médiane sur l'axe le plus long (40 000 barycentres)            | 1.023      | 1.043      | −2.0 % | oui       |
| F5 bourrage à quatre octets (10⁶ longueurs + voisinage de `usize::MAX`) | 0.167      | 0.169      | −1.3 % | oui       |
| F6 normalisation gardée (300 000 vecteurs, 1/9 sous la garde)           | 1.058      | 1.060      | −0.1 % | oui       |
| F7 secondes → millisecondes                                             | null       | null       | null   | hors banc |

Aucune ligne ne cherche un gain : les écarts restent dans le bruit de la machine (±3 %), et la
colonne « identique » est la seule qui décide. Une ligne « non » vaudrait retour en arrière.

## Doublons laissés séparés

- `albedo.rs::srgb_to_linear` (f64) contre la table de `texture_preview/reduce.rs` (f32) : 214 des 256 entrées diffèrent du `f64` arrondi, construire la table depuis la fonction changerait les octets de l'aperçu.
- `linear_to_srgb` de `texture_preview/reduce.rs` contre `deferredLightingShaders.ts` : paire Rust/TypeScript, pas de code partagé, miroir nommé en commentaire.
- `dag/bounds.rs::merge_spheres` contre `pageSelectionCutBounds.ts::growSphere` : paire Rust/TypeScript ; le repli séquentiel non commutatif reste tel quel, miroir nommé en commentaire.
- `dag/clusters.rs::edge_key` (u64) contre `topology.rs::edge_key` (couple) : encodages et tables différents, aligner l'un changerait l'ordre d'itération de sa table.
- Axe le plus long de `proxy/bvh.rs` : `max_by` garde le dernier axe à égalité là où le `>` du DAG garde le premier, et la coupe est un `select_nth_unstable_by`, pas un tri complet.
- Empaquetage glouton `compiler_bundles.rs` (un seuil de taille) contre `compiler_primitive_bundle.rs` (seuil + rupture de clé racine/niveau) : deux règles, pas une option.
- `coplanar.rs::offset_quantum` : chaque borne d'axe est lue et gardée séparément, une page sans `min` lisible pouvant porter un `max`.
- `coplanar/plane.rs::plane_of_triangles` : zone intouchable, l'ordre des sommations décide des surfaces coplanaires ; sa boîte reste sur place, commentaire posé.
- Taille d'un niveau de mip : `texture_preview/levels.rs::preview_level_size` est désormais le seul exemplaire côté Rust, le pilote DDS du catalogue n'existe plus dans `develop`.
- `packages/page-codec-wasm/src/*.rs` : aucune formule dupliquée à l'intérieur, et c'est une caisse séparée — partager avec `asset-compiler-rust` demanderait une dépendance que le décodeur n'a pas.
