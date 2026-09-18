# Tables de scène à l'import

> 30 nodes · cohesion 0.08

## Key Concepts

- **SceneTables** (21 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.write()** (9 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **tables.rs** (6 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **SceneTables** (3 connections) — `packages/asset-compiler-rust/src/import/tables/media.rs`
- **Value** (3 connections)
- **.count()** (3 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.new()** (3 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.image()** (2 connections) — `packages/asset-compiler-rust/src/import/tables/media.rs`
- **.texture()** (2 connections) — `packages/asset-compiler-rust/src/import/tables/media.rs`
- **BTreeMap** (2 connections)
- **String** (2 connections)
- **.counts()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.key()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.node()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.nodes()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.roots()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.sampler_filtered()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **.sampler_uv()** (2 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **DEFAULT_FILTER** (1 connections) — `packages/asset-compiler-rust/src/import/tables.rs`
- **String** (1 connections)
- **.image_unreadable()** (1 connections) — `packages/asset-compiler-rust/src/import/tables/media.rs`
- **HashMap** (1 connections)
- **Instant** (1 connections)
- **PathBuf** (1 connections)
- **Result** (1 connections)
- *... and 5 more nodes in this community*

## Relationships

- [Greffons de scène du compilateur](Greffons_de_scène_du_compilateur.md) (4 shared connections)
- [import · Option](import_·_Option.md) (3 shared connections)
- [Import Unity et maillages](Import_Unity_et_maillages.md) (1 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (1 shared connections)
- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/import/tables.rs`
- `packages/asset-compiler-rust/src/import/tables/media.rs`

## Audit Trail

- EXTRACTED: 45 (98%)
- INFERRED: 1 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*