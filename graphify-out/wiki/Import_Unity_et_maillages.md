# Import Unity et maillages

> 57 nodes · cohesion 0.04

## Key Concepts

- **import.rs** (29 connections) — `packages/asset-compiler-rust/src/import.rs`
- **unity.rs** (23 connections) — `packages/asset-compiler-rust/src/plugins/scene/unity.rs`
- **scene** (10 connections)
- **.load()** (9 connections) — `packages/asset-compiler-rust/src/import/scene.rs`
- **mesh_json()** (9 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- **alembic/scene.rs** (8 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/scene.rs`
- **scene/write.rs** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/scene/write.rs`
- **collections** (6 connections)
- **Mesh** (6 connections)
- **blend/build.rs** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- **CornerHasher** (5 connections) — `packages/asset-compiler-rust/src/import.rs`
- **lighting.rs** (5 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **.push_light()** (5 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **import_error()** (4 connections) — `packages/asset-compiler-rust/src/import.rs`
- **light_matrix()** (4 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **.vertex()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- **matrix_is_finite()** (3 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **matrix_json()** (3 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **normalise()** (3 connections) — `packages/asset-compiler-rust/src/import.rs`
- **.check()** (3 connections) — `packages/asset-compiler-rust/src/import/scene.rs`
- **Primitive** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- **slice3()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- **hash** (2 connections)
- **Light** (2 connections)
- **materials** (2 connections)
- *... and 32 more nodes in this community*

## Relationships

- [import · Option](import_·_Option.md) (5 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (5 shared connections)
- [alembic · BTreeMap](alembic_·_BTreeMap.md) (4 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (3 shared connections)
- [Import Unity et maillages (2)](Import_Unity_et_maillages_2.md) (3 shared connections)
- [scene · .accepts_head](scene_·_.accepts_head.md) (3 shared connections)
- [unity · Fn](unity_·_Fn.md) (3 shared connections)
- [Routage des conteneurs d'archives](Routage_des_conteneurs_d'archives.md) (3 shared connections)
- [blend · HashMap](blend_·_HashMap.md) (2 shared connections)
- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (2 shared connections)
- [Import Unity et maillages (3)](Import_Unity_et_maillages_3.md) (2 shared connections)
- [Jeux de bancs Rust](Jeux_de_bancs_Rust.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/import.rs`
- `packages/asset-compiler-rust/src/import/lighting.rs`
- `packages/asset-compiler-rust/src/import/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/scene/write.rs`
- `packages/asset-compiler-rust/src/plugins/scene/blend/build.rs`
- `packages/asset-compiler-rust/src/plugins/scene/unity.rs`

## Audit Trail

- EXTRACTED: 126 (96%)
- INFERRED: 5 (4%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*