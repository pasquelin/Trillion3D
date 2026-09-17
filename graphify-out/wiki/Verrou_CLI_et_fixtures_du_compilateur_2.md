# Verrou CLI et fixtures du compilateur (2)

> 44 nodes

## Key Concepts

- **scene/archive.rs** (18 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **container.rs** (16 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **container()** (16 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **compose()** (12 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **extract()** (10 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **zip_reader.rs** (8 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **safe_join()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **open()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **stage_in_place()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **whole()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **only_input()** (6 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **chain()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **only_child()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **ready()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **Option** (5 connections)
- **single_root()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- **extraction_dir()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **Result** (5 connections)
- **Result** (4 connections)
- **check()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **EMPTY** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **under_byte_limit()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **under_entry_limit()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- **Fn** (2 connections)
- **PathBuf** (2 connections)
- *... and 19 more nodes in this community*

## Relationships

- [unity · les_mesures_et_la_provenance_sortent_de_lidentite](unity_·_les_mesures_et_la_provenance_sortent_de_lidentite.md) (12 shared connections)
- [plugins · AsRef](plugins_·_AsRef.md) (9 shared connections)
- [Tables de scène à l'import](Tables_de_scène_à_l'import.md) (5 shared connections)
- [Aperçus de textures et pyramide (2)](Aperçus_de_textures_et_pyramide_2.md) (3 shared connections)
- [Erreurs du compilateur et USDZ](Erreurs_du_compilateur_et_USDZ.md) (3 shared connections)
- [Écriture de la scène source](Écriture_de_la_scène_source.md) (2 shared connections)
- [Extraction unitypackage](Extraction_unitypackage.md) (2 shared connections)
- [scene · .accepts_head (2)](scene_·_.accepts_head_2.md) (1 shared connections)
- [scene · .accepts_head](scene_·_.accepts_head.md) (1 shared connections)
- [alembic · a_group_above_the_allocation_ceiling_is_refused_by_name](alembic_·_a_group_above_the_allocation_ceiling_is_refused_by_name.md) (1 shared connections)
- [Routage des conteneurs d'archives](Routage_des_conteneurs_d'archives.md) (1 shared connections)
- [Validation du compilateur](Validation_du_compilateur.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/plugins/scene/archive.rs`
- `packages/asset-compiler-rust/src/plugins/scene/archive/container.rs`
- `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`

## Audit Trail

- EXTRACTED: 102 (88%)
- INFERRED: 14 (12%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*