# Greffons de scène du compilateur

> 83 nodes · cohesion 0.05

## Key Concepts

- **ScenePlugin** (43 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **SceneRequest** (35 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **PreparedScene** (22 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **scene/archive.rs** (18 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **container.rs** (16 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **container()** (16 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **plugins/scene.rs** (13 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **finish()** (13 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **compose()** (12 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **SceneOutput** (12 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **extract()** (10 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **PathBuf** (10 connections)
- **.new()** (8 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **convert()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- **safe_join()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **.write()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **stage_in_place()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **whole()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **only_input()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **image_root()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene.rs`
- **source_file()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- **chain()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **only_child()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **ready()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **Option** (5 connections)
- *... and 58 more nodes in this community*

## Relationships

- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (18 shared connections)
- [scene · .accepts_head](scene_·_.accepts_head.md) (10 shared connections)
- [Greffons et pilotes de scène](Greffons_et_pilotes_de_scène.md) (8 shared connections)
- [import · Option](import_·_Option.md) (7 shared connections)
- [Routage des conteneurs d'archives](Routage_des_conteneurs_d'archives.md) (6 shared connections)
- [Erreurs du compilateur et USDZ](Erreurs_du_compilateur_et_USDZ.md) (6 shared connections)
- [Extraction unitypackage](Extraction_unitypackage.md) (6 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (4 shared connections)
- [Tables de scène à l'import](Tables_de_scène_à_l'import.md) (4 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (3 shared connections)
- [Greffons de scène du compilateur (2)](Greffons_de_scène_du_compilateur_2.md) (3 shared connections)
- [usd · PathBuf](usd_·_PathBuf.md) (3 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/plugins/scene.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic.rs`
- `packages/asset-compiler-rust/src/plugins/scene/alembic/convert.rs`
- `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- `packages/asset-compiler-rust/src/plugins/scene/blend.rs`
- `packages/asset-compiler-rust/src/plugins/scene/gltf.rs`
- `packages/asset-compiler-rust/src/plugins/scene/ufbx_driver.rs`
- `packages/asset-compiler-rust/src/plugins/scene/unity.rs`
- `packages/asset-compiler-rust/src/plugins/scene/zip.rs`

## Audit Trail

- EXTRACTED: 254 (94%)
- INFERRED: 15 (6%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*