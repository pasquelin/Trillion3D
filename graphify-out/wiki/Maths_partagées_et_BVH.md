# Maths partagées et BVH

> 38 nodes

## Key Concepts

- **shared_math_tests.rs** (15 connections) — `packages/asset-compiler-rust/src/shared_math_tests.rs`
- **shared_math.rs** (13 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **f_scalaires.rs** (10 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **extend_aabb()** (10 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **build_culling_bvh()** (8 connections) — `packages/asset-compiler-rust/src/dag/culling.rs`
- **bisect_centres()** (8 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **row_normalisation()** (5 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **node_bounds()** (5 connections) — `packages/asset-compiler-rust/src/dag/culling.rs`
- **merge_aabb()** (5 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **row_bourrage()** (4 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **culling.rs** (4 connections) — `packages/asset-compiler-rust/src/dag/culling.rs`
- **extend_aabb_f32()** (3 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **longest_axis()** (3 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **directions()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **empreinte_bourrage()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **empreinte_vecteurs()** (2 connections) — `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- **Bits** (2 connections)
- **DagCluster** (2 connections)
- **elapsed_ms()** (2 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **normalized_or()** (2 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **pad_to_4()** (2 connections) — `packages/asset-compiler-rust/src/shared_math.rs`
- **bisect_centres_sorts_an_even_group_and_splits_it_in_half()** (2 connections) — `packages/asset-compiler-rust/src/shared_math_tests.rs`
- **bisect_centres_splits_an_odd_group_with_the_larger_half_last()** (2 connections) — `packages/asset-compiler-rust/src/shared_math_tests.rs`
- **extend_aabb_f32_starts_from_an_empty_box()** (2 connections) — `packages/asset-compiler-rust/src/shared_math_tests.rs`
- **extend_aabb_keeps_the_sign_of_negative_zero()** (2 connections) — `packages/asset-compiler-rust/src/shared_math_tests.rs`
- *... and 13 more nodes in this community*

## Relationships

- [bench_calculs · Bits (5)](bench_calculs_·_Bits_5.md) (8 shared connections)
- [dag · Bits](dag_·_Bits.md) (5 shared connections)
- [Rapport des bancs de calcul](Rapport_des_bancs_de_calcul.md) (2 shared connections)
- [DAG et stratégie de coupe](DAG_et_stratégie_de_coupe.md) (2 shared connections)
- [Jeux de bancs Rust](Jeux_de_bancs_Rust.md) (1 shared connections)
- [Fixtures OBJ du compilateur](Fixtures_OBJ_du_compilateur.md) (1 shared connections)
- [Groupes et bissection du DAG](Groupes_et_bissection_du_DAG.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/bench_calculs/f_scalaires.rs`
- `packages/asset-compiler-rust/src/dag/culling.rs`
- `packages/asset-compiler-rust/src/shared_math.rs`
- `packages/asset-compiler-rust/src/shared_math_tests.rs`

## Audit Trail

- EXTRACTED: 52 (67%)
- INFERRED: 26 (33%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*