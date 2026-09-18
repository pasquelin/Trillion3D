# src · Fn

> 19 nodes · cohesion 0.16

## Key Concepts

- **qem_tests.rs** (12 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **simplify_with_locked_vertices()** (10 connections) — `packages/asset-compiler-rust/src/qem.rs`
- **compact_region()** (8 connections) — `packages/asset-compiler-rust/src/qem.rs`
- **qem.rs** (7 connections) — `packages/asset-compiler-rust/src/qem.rs`
- **SimplifiedMesh** (2 connections) — `packages/asset-compiler-rust/src/qem.rs`
- **a_mesh_already_below_the_target_is_returned_untouched()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **compact_region_falls_back_to_zero_for_an_index_beyond_the_positions()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **compact_region_on_a_degenerate_triangle_renumbers_the_repeated_vertex_once()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **compact_region_on_a_single_triangle_keeps_every_vertex_once()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **compact_region_on_an_empty_mesh_returns_empty_lists()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **compact_region_renumbers_each_vertex_once_and_maps_back()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **free_vertices_reduce_a_closed_cube()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **locked_vertices_keep_every_triangle()** (2 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **meshopt** (1 connections)
- **Fn** (1 connections)
- **Result** (1 connections)
- **CUBE_INDICES** (1 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **CUBE_POSITIONS** (1 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`
- **malformed_input_is_rejected()** (1 connections) — `packages/asset-compiler-rust/src/qem_tests.rs`

## Relationships

- [DAG et stratégie de coupe](DAG_et_stratégie_de_coupe.md) (2 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (1 shared connections)
- [Bancs de calcul Rust (2)](Bancs_de_calcul_Rust_2.md) (1 shared connections)
- [Construction du DAG](Construction_du_DAG.md) (1 shared connections)
- [src · Option (2)](src_·_Option_2.md) (1 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/qem.rs`
- `packages/asset-compiler-rust/src/qem_tests.rs`

## Audit Trail

- EXTRACTED: 23 (68%)
- INFERRED: 11 (32%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*