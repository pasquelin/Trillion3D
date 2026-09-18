# tests · Fn

> 25 nodes · cohesion 0.12

## Key Concepts

- **prune_cache()** (10 connections) — `packages/asset-compiler-rust/src/compiler_prune.rs`
- **referenced_objects()** (9 connections) — `packages/asset-compiler-rust/src/compiler_prune.rs`
- **obj_fixture()** (9 connections) — `packages/asset-compiler-rust/src/tests/fixtures.rs`
- **other_scope()** (7 connections) — `packages/asset-compiler-rust/src/compiler_prune.rs`
- **part6.rs** (6 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **compiler_prune.rs** (5 connections) — `packages/asset-compiler-rust/src/compiler_prune.rs`
- **objects_on_disk()** (5 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **part7.rs** (4 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **Result** (3 connections)
- **pruning_one_scope_keeps_the_objects_the_other_scope_needs()** (3 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **a_sidecar_of_another_version_stops_the_prune_without_removing_anything()** (3 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **BTreeSet** (2 connections)
- **String** (2 connections)
- **Value** (2 connections)
- **directory_of_importable_files_is_merged_into_one_scene()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **obj_source_is_imported_into_the_cache_then_compiled()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **recompiling_prunes_stale_keys_and_orphan_objects()** (2 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **cancelled_import_reports_cancelled()** (2 connections) — `packages/asset-compiler-rust/src/tests/part7.rs`
- **Fn** (1 connections)
- **Option** (1 connections)
- **Sync** (1 connections)
- **TexturePreview** (1 connections)
- **gltf_sources_never_go_through_the_importer()** (1 connections) — `packages/asset-compiler-rust/src/tests/part6.rs`
- **BTreeSet** (1 connections)
- **String** (1 connections)

## Relationships

- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (4 shared connections)
- [Empaquetage des pages DAG](Empaquetage_des_pages_DAG.md) (2 shared connections)
- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (2 shared connections)
- [Budget et ouvriers du compilateur (2)](Budget_et_ouvriers_du_compilateur_2.md) (2 shared connections)
- [Lecture et écriture glTF](Lecture_et_écriture_glTF.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/compiler_prune.rs`
- `packages/asset-compiler-rust/src/tests/fixtures.rs`
- `packages/asset-compiler-rust/src/tests/part6.rs`
- `packages/asset-compiler-rust/src/tests/part7.rs`

## Audit Trail

- EXTRACTED: 40 (83%)
- INFERRED: 8 (17%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*