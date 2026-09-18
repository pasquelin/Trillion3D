# DAG et stratégie de coupe

> 31 nodes · cohesion 0.07

## Key Concepts

- **dag.rs** (27 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **reduce_group()** (13 connections) — `packages/asset-compiler-rust/src/dag/groups.rs`
- **CullingNode** (4 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DagCluster** (4 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DagStrategy** (3 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **GroupOutcome** (3 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **GroupTally** (3 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **prelude** (3 connections)
- **.default()** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **.named()** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **GroupReduction** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **GroupReductionInput** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **.record()** (2 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **Self** (2 connections)
- **build_culling_bvh** (1 connections)
- **build_dag_tallied** (1 connections)
- **groups** (1 connections)
- **CULLING_BRANCHING** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **CULLING_LEAF** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DAG_CLUSTER_TRIANGLES** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DAG_CLUSTER_VERTICES** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DAG_GROUP_MAX** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DAG_GROUP_MIN** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **DAG_MAX_LEVELS** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- **.is_root()** (1 connections) — `packages/asset-compiler-rust/src/dag.rs`
- *... and 6 more nodes in this community*

## Relationships

- [Construction du DAG](Construction_du_DAG.md) (8 shared connections)
- [src · Fn](src_·_Fn.md) (2 shared connections)
- [dag · Bits](dag_·_Bits.md) (2 shared connections)
- [Maths partagées et BVH](Maths_partagées_et_BVH.md) (2 shared connections)
- [Groupes et bissection du DAG](Groupes_et_bissection_du_DAG.md) (2 shared connections)
- [Minuterie et phases de travail](Minuterie_et_phases_de_travail.md) (1 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (1 shared connections)
- [Bancs de calcul Rust (2)](Bancs_de_calcul_Rust_2.md) (1 shared connections)
- [Empaquetage des pages DAG](Empaquetage_des_pages_DAG.md) (1 shared connections)
- [Oracle : rayons et indirect](Oracle_-_rayons_et_indirect.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/dag.rs`
- `packages/asset-compiler-rust/src/dag/groups.rs`

## Audit Trail

- EXTRACTED: 49 (89%)
- INFERRED: 6 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*