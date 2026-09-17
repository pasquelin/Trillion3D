# Construction du DAG

> 32 nodes

## Key Concepts

- **build_dag_tallied()** (20 connections) — `packages/asset-compiler-rust/src/dag/build.rs`
- **clusters.rs** (10 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **cluster_triangles()** (7 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **grid()** (7 connections) — `packages/asset-compiler-rust/src/dag/tests/mod.rs`
- **an_isolated_sheet_simplifies_its_whole_boundary()** (7 connections) — `packages/asset-compiler-rust/src/dag/tests/part2.rs`
- **Grouped** (6 connections) — `packages/asset-compiler-rust/src/dag/tests/mod.rs`
- **cluster_adjacency()** (5 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **weld_positions()** (5 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **group_simplification_pins_shared_vertices_and_frees_the_open_boundary()** (5 connections) — `packages/asset-compiler-rust/src/dag/tests/part2.rs`
- **dag/tests/part3.rs** (5 connections) — `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- **level_locks()** (4 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **dag/tests/mod.rs** (4 connections) — `packages/asset-compiler-rust/src/dag/tests/mod.rs`
- **build()** (4 connections) — `packages/asset-compiler-rust/src/dag/tests/mod.rs`
- **dag/tests/part2.rs** (4 connections) — `packages/asset-compiler-rust/src/dag/tests/part2.rs`
- **a_group_and_its_replacement_cover_the_same_triangles_once()** (4 connections) — `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- **position_key()** (3 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **build_honours_cancellation()** (3 connections) — `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- **every_group_owns_its_children_and_its_coarse_replacement()** (3 connections) — `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- **dag/build.rs** (2 connections) — `packages/asset-compiler-rust/src/dag/build.rs`
- **edge_key()** (2 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **normalized_bits()** (2 connections) — `packages/asset-compiler-rust/src/dag/clusters.rs`
- **DagGroup** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **a_planar_sheet_keeps_its_exact_level_and_coarsens_without_error()** (2 connections) — `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- **.area()** (2 connections) — `packages/asset-compiler-rust/src/proxy/bvh.rs`
- **hashset** (2 connections)
- *... and 7 more nodes in this community*

## Relationships

- [DAG et stratégie de coupe](DAG_et_stratégie_de_coupe.md) (8 shared connections)
- [tests · compiler_accessor_decode](tests_·_compiler_accessor_decode.md) (5 shared connections)
- [dag · Bits](dag_·_Bits.md) (4 shared connections)
- [Groupes et bissection du DAG](Groupes_et_bissection_du_DAG.md) (2 shared connections)
- [bench_calculs · Bits](bench_calculs_·_Bits.md) (1 shared connections)
- [src · Fn](src_·_Fn.md) (1 shared connections)
- [proxy · extent](proxy_·_extent.md) (1 shared connections)
- [proxy · CELL_ERROR_FACTOR](proxy_·_CELL_ERROR_FACTOR.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/dag.rs`
- `packages/asset-compiler-rust/src/dag/build.rs`
- `packages/asset-compiler-rust/src/dag/clusters.rs`
- `packages/asset-compiler-rust/src/dag/tests/mod.rs`
- `packages/asset-compiler-rust/src/dag/tests/part2.rs`
- `packages/asset-compiler-rust/src/dag/tests/part3.rs`
- `packages/asset-compiler-rust/src/proxy/bvh.rs`

## Audit Trail

- EXTRACTED: 42 (56%)
- INFERRED: 33 (44%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*