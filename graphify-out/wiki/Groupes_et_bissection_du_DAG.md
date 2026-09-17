# Groupes et bissection du DAG

> 26 nodes

## Key Concepts

- **dag/tests/part5.rs** (8 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **b3_bisection.rs** (7 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- **b3_bordure.rs** (6 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bordure.rs`
- **dag/groups.rs** (6 connections) — `packages/asset-compiler-rust/src/dag/groups.rs`
- **refine_bisection()** (6 connections) — `packages/asset-compiler-rust/src/dag/groups.rs`
- **row()** (5 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- **group_clusters()** (5 connections) — `packages/asset-compiler-rust/src/dag/groups.rs`
- **row()** (4 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bordure.rs`
- **border_survived()** (3 connections) — `packages/asset-compiler-rust/src/dag/groups.rs`
- **empreinte()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- **reference_affiner()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- **voisinage()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- **empreinte()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bordure.rs`
- **reference_bordure()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/b3_bordure.rs`
- **refine_bisection_ignores_a_neighbour_outside_the_slice()** (2 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **refine_bisection_moves_a_member_whose_neighbours_are_mostly_on_the_other_side()** (2 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **refine_bisection_on_a_single_member_slice_leaves_it_in_place_and_clears_present()** (2 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **Bits** (1 connections)
- **Bits** (1 connections)
- **border_survived_detects_a_locked_vertex_lost_by_simplification()** (1 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **border_survived_follows_welding_not_raw_indices()** (1 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **border_survived_handles_a_group_of_thirty_two_clusters_worth_of_corners()** (1 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **border_survived_is_true_when_nothing_is_locked()** (1 connections) — `packages/asset-compiler-rust/src/dag/tests/part5.rs`
- **bisect_centres** (1 connections)
- **border_survived** (1 connections)
- *... and 1 more nodes in this community*

## Relationships

- [bench_calculs · Bits (5)](bench_calculs_·_Bits_5.md) (4 shared connections)
- [Jeux de bancs Rust](Jeux_de_bancs_Rust.md) (2 shared connections)
- [Fixtures OBJ du compilateur](Fixtures_OBJ_du_compilateur.md) (2 shared connections)
- [DAG et stratégie de coupe](DAG_et_stratégie_de_coupe.md) (2 shared connections)
- [Construction du DAG](Construction_du_DAG.md) (2 shared connections)
- [Maths partagées et BVH](Maths_partagées_et_BVH.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/bench_calculs/b3_bisection.rs`
- `packages/asset-compiler-rust/src/bench_calculs/b3_bordure.rs`
- `packages/asset-compiler-rust/src/dag/groups.rs`
- `packages/asset-compiler-rust/src/dag/tests/part5.rs`

## Audit Trail

- EXTRACTED: 34 (77%)
- INFERRED: 10 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*