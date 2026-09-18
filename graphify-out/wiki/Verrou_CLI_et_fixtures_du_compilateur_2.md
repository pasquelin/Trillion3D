# Verrou CLI et fixtures du compilateur (2)

> 9 nodes · cohesion 0.25

## Key Concepts

- **zip_reader.rs** (8 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **open()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **Result** (2 connections)
- **ZipArchive** (2 connections)
- **accepts_head()** (1 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **END_OF_CENTRAL_DIRECTORY** (1 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **LOCAL_FILE_HEADER** (1 connections) — `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`
- **BufReader** (1 connections)
- **File** (1 connections)

## Relationships

- [Greffons de scène du compilateur](Greffons_de_scène_du_compilateur.md) (2 shared connections)
- [scene · .accepts_head](scene_·_.accepts_head.md) (1 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (1 shared connections)
- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (1 shared connections)
- [Extraction unitypackage](Extraction_unitypackage.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/plugins/scene/archive/zip_reader.rs`

## Audit Trail

- EXTRACTED: 14 (93%)
- INFERRED: 1 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*