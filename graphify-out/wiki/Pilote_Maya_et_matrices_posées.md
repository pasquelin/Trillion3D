# Pilote Maya et matrices posées

> 44 nodes

## Key Concepts

- **compile_ma()** (17 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **ma_driver.rs** (13 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **ma_xform.rs** (10 connections) — `packages/asset-compiler-rust/src/tests/ma_xform.rs`
- **posed_matrix()** (9 connections) — `packages/asset-compiler-rust/src/tests/ma_xform.rs`
- **ma_matiere.rs** (8 connections) — `packages/asset-compiler-rust/src/tests/ma_matiere.rs`
- **ma_fidelite.rs** (7 connections) — `packages/asset-compiler-rust/src/tests/ma_fidelite.rs`
- **ma_normales.rs** (7 connections) — `packages/asset-compiler-rust/src/tests/ma_normales.rs`
- **normals()** (5 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **matrix()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **translations()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **material()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_matiere.rs`
- **a_hard_edge_splits_the_shading_of_the_two_faces_it_separates()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_normales.rs`
- **a_soft_edge_carries_the_shading_from_one_face_to_the_next()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_normales.rs`
- **roof()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_normales.rs`
- **an_offset_parent_matrix_applies_after_the_local_pose()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_xform.rs`
- **posed()** (4 connections) — `packages/asset-compiler-rust/src/tests/ma_xform.rs`
- **Value** (3 connections)
- **two_transforms_of_the_same_name_under_two_parents_stay_two_nodes()** (3 connections) — `packages/asset-compiler-rust/src/tests/ma_fidelite.rs`
- **only_a_tangent_space_bump_becomes_a_normal_texture()** (3 connections) — `packages/asset-compiler-rust/src/tests/ma_matiere.rs`
- **the_scalar_weight_of_a_textured_colour_reaches_the_gltf_factor()** (3 connections) — `packages/asset-compiler-rust/src/tests/ma_matiere.rs`
- **quad()** (2 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **String** (2 connections)
- **shaded()** (2 connections) — `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- **a_face_citing_the_lowest_edge_index_is_refused_by_name()** (2 connections) — `packages/asset-compiler-rust/src/tests/ma_fidelite.rs`
- **an_intermediate_or_invisible_shape_never_reaches_the_scene()** (2 connections) — `packages/asset-compiler-rust/src/tests/ma_fidelite.rs`
- *... and 19 more nodes in this community*

## Relationships

- [tests · compiler_accessor_decode](tests_·_compiler_accessor_decode.md) (5 shared connections)
- [Exécution des tests dorés](Exécution_des_tests_dorés.md) (2 shared connections)
- [Bacs à sable des pilotes](Bacs_à_sable_des_pilotes.md) (1 shared connections)
- [Bacs à sable des pilotes (2)](Bacs_à_sable_des_pilotes_2.md) (1 shared connections)
- [tests · each_prefab_override_names_its_own_object_and_ten_runs_agree](tests_·_each_prefab_override_names_its_own_object_and_ten_runs_agree.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/tests/ma_driver.rs`
- `packages/asset-compiler-rust/src/tests/ma_fidelite.rs`
- `packages/asset-compiler-rust/src/tests/ma_matiere.rs`
- `packages/asset-compiler-rust/src/tests/ma_normales.rs`
- `packages/asset-compiler-rust/src/tests/ma_xform.rs`

## Audit Trail

- EXTRACTED: 64 (76%)
- INFERRED: 20 (24%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*