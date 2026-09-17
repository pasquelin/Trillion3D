# Greffons de scène du compilateur

> 58 nodes

## Key Concepts

- **ScenePlugin** (41 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **SceneRequest** (34 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **PreparedScene** (22 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **plugins/scene.rs** (11 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **import_source()** (9 connections) — `packages/asset-compiler-rust/src/import/runner.rs`
- **PathBuf** (8 connections)
- **convert()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- **convert()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/convert.rs`
- **.new()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **image_root()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **runner.rs** (5 connections) — `packages/asset-compiler-rust/src/import/runner.rs`
- **base_key()** (5 connections) — `packages/asset-compiler-rust/src/import/runner.rs`
- **source_file()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- **blend/convert.rs** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/convert.rs`
- **single()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/convert.rs`
- **reusable()** (4 connections) — `packages/asset-compiler-rust/src/import/runner.rs`
- **.prepare()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic.rs`
- **.prepare()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend.rs`
- **name_of()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/blend/convert.rs`
- **.prepare()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/gltf.rs`
- **.converted()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **.images()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **.prepare()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **.project_inputs()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **.converted()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- *... and 33 more nodes in this community*

## Relationships

- [Verrou CLI et fixtures du compilateur (2)](Verrou_CLI_et_fixtures_du_compilateur_2.md) (14 shared connections)
- [unity · Option](unity_·_Option.md) (13 shared connections)
- [Greffons et pilotes de scène](Greffons_et_pilotes_de_scène.md) (8 shared connections)
- [scene · .accepts_head](scene_·_.accepts_head.md) (8 shared connections)
- [Routage des conteneurs d'archives](Routage_des_conteneurs_d'archives.md) (5 shared connections)
- [Extraction unitypackage](Extraction_unitypackage.md) (5 shared connections)
- [Fixtures OBJ du compilateur](Fixtures_OBJ_du_compilateur.md) (3 shared connections)
- [Tables de scène à l'import](Tables_de_scène_à_l'import.md) (3 shared connections)
- [scene · CompressionMethod](scene_·_CompressionMethod.md) (3 shared connections)
- [usd · BTreeMap](usd_·_BTreeMap.md) (3 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (2 shared connections)
- [import · DEFAULT_FILTER](import_·_DEFAULT_FILTER.md) (2 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/import/runner.rs`
- `packages/asset-compiler-rust/src/plugins/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- `packages/asset-compiler-rust/src/plugins/scene/blend.rs`
- `packages/asset-compiler-rust/src/plugins/scene/blend/convert.rs`
- `packages/asset-compiler-rust/src/plugins/scene/gltf.rs`
- `packages/asset-compiler-rust/src/plugins/scene/ufbx_driver.rs`
- `packages/asset-compiler-rust/src/plugins/scene/unity.rs`
- `packages/asset-compiler-rust/src/plugins/scene/zip.rs`

## Audit Trail

- EXTRACTED: 176 (98%)
- INFERRED: 3 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*