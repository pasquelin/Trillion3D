# Fixtures OBJ du compilateur

> 19 nodes

## Key Concepts

- **obj_fixture()** (9 connections) — `packages/asset-compiler-rust/src/tests/fixtures.rs`
- **part6.rs** (6 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **cube_fixture()** (5 connections) — `packages/asset-compiler-rust/src/tests/fixtures.rs`
- **objects_on_disk()** (5 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **assert_cache_coherent()** (4 connections) — `packages/asset-compiler-rust/src/tests/cache_verrou.rs`
- **part7.rs** (4 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **cache_verrou.rs** (3 connections) — `packages/asset-compiler-rust/src/tests/cache_verrou.rs`
- **a02_deux_fils_sur_un_meme_cache_laissent_un_pointeur_lisible()** (3 connections) — `packages/asset-compiler-rust/src/tests/cache_verrou.rs`
- **PathBuf** (3 connections)
- **pruning_one_scope_keeps_the_objects_the_other_scope_needs()** (3 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **a_sidecar_of_another_version_stops_the_prune_without_removing_anything()** (3 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **compile_slice_keeps_the_smallest_mesh_when_budget_is_below_one_instance()** (2 connections) — `packages/asset-compiler-rust/src/tests/part5.rs`
- **directory_of_importable_files_is_merged_into_one_scene()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **obj_source_is_imported_into_the_cache_then_compiled()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **recompiling_prunes_stale_keys_and_orphan_objects()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **cancelled_import_reports_cancelled()** (2 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **gltf_sources_never_go_through_the_importer()** (1 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **BTreeSet** (1 connections)
- **String** (1 connections)

## Relationships

- [Aperçus de textures et pyramide (2)](Aperçus_de_textures_et_pyramide_2.md) (5 shared connections)
- [Budget et ouvriers du compilateur (2)](Budget_et_ouvriers_du_compilateur_2.md) (4 shared connections)
- [unity · les_mesures_et_la_provenance_sortent_de_lidentite](unity_·_les_mesures_et_la_provenance_sortent_de_lidentite.md) (2 shared connections)
- [Fixtures de grille et ratios](Fixtures_de_grille_et_ratios.md) (1 shared connections)
- [src · Fn (2)](src_·_Fn_2.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/tests/cache_verrou.rs`
- `packages/asset-compiler-rust/src/tests/fixtures.rs`
- `packages/asset-compiler-rust/src/tests/part5.rs`
- `packages/asset-compiler-rust/src/tests/part6.rs`
- `packages/asset-compiler-rust/src/tests/part7.rs`

## Audit Trail

- EXTRACTED: 27 (73%)
- INFERRED: 10 (27%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*