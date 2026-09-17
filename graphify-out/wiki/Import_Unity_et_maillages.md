# Import Unity et maillages

> 50 nodes

## Key Concepts

- **import.rs** (29 connections) — `packages/asset-compiler-rust/src/import.rs`
- **unity.rs** (23 connections) — `packages/asset-compiler-rust/src/plugins/scene/unity.rs`
- **.load()** (9 connections) — `packages/asset-compiler-rust/src/import/scene.rs`
- **alembic/scene.rs** (9 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/scene.rs`
- **Trs** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/unity/transform.rs`
- **Mesh** (6 connections)
- **scene/write.rs** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/scene/write.rs`
- **collections** (6 connections)
- **CornerHasher** (5 connections) — `packages/asset-compiler-rust/src/import.rs`
- **lighting.rs** (5 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **.push_light()** (5 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **import_error()** (4 connections) — `packages/asset-compiler-rust/src/import.rs`
- **light_matrix()** (4 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **matrix_is_finite()** (3 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **matrix_json()** (3 connections) — `packages/asset-compiler-rust/src/import/lighting.rs`
- **normalise()** (3 connections) — `packages/asset-compiler-rust/src/import.rs`
- **.check()** (3 connections) — `packages/asset-compiler-rust/src/import/scene.rs`
- **hash** (3 connections)
- **Light** (2 connections)
- **Opacity** (2 connections)
- **Node** (2 connections)
- **Importer<'a>** (2 connections) — `packages/asset-compiler-rust/src/import/scene.rs`
- **Result** (2 connections)
- **transform.rs** (2 connections) — `packages/asset-compiler-rust/src/plugins/scene/unity/transform.rs`
- **.write()** (2 connections) — `packages/asset-compiler-rust/src/plugins/scene/unity/transform.rs`
- *... and 25 more nodes in this community*

## Relationships

- [Aperçus de textures et pyramide (2)](Aperçus_de_textures_et_pyramide_2.md) (6 shared connections)
- [Jeux de bancs Rust](Jeux_de_bancs_Rust.md) (4 shared connections)
- [Tables de scène à l'import](Tables_de_scène_à_l'import.md) (3 shared connections)
- [alembic · BTreeMap](alembic_·_BTreeMap.md) (3 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (2 shared connections)
- [Verrou CLI et fixtures du compilateur](Verrou_CLI_et_fixtures_du_compilateur.md) (2 shared connections)
- [blend · NGON_UNCUT](blend_·_NGON_UNCUT.md) (2 shared connections)
- [Rapport et table des textures](Rapport_et_table_des_textures.md) (2 shared connections)
- [unity · les_mesures_et_la_provenance_sortent_de_lidentite](unity_·_les_mesures_et_la_provenance_sortent_de_lidentite.md) (2 shared connections)
- [unity · Fn](unity_·_Fn.md) (2 shared connections)
- [unity · Overrides](unity_·_Overrides.md) (2 shared connections)
- [scene · AtomicBool](scene_·_AtomicBool.md) (2 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/import.rs`
- `packages/asset-compiler-rust/src/import/lighting.rs`
- `packages/asset-compiler-rust/src/import/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/scene/write.rs`
- `packages/asset-compiler-rust/src/plugins/scene/unity.rs`
- `packages/asset-compiler-rust/src/plugins/scene/unity/transform.rs`

## Audit Trail

- EXTRACTED: 109 (96%)
- INFERRED: 5 (4%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*