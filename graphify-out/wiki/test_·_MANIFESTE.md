# test · MANIFESTE

> 12 nodes · cohesion 0.27

## Key Concepts

- **build-wasm.mjs** (12 connections) — `scripts/build-wasm.mjs`
- **build-wasm.test.mjs** (10 connections) — `scripts/build-wasm.test.mjs`
- **main()** (4 connections) — `scripts/build-wasm.mjs`
- **archiveur()** (3 connections) — `scripts/build-wasm.mjs`
- **rustc()** (3 connections) — `scripts/build-wasm.mjs`
- **moduleFactice()** (3 connections) — `scripts/build-wasm.test.mjs`
- **verifieJeuInstructions()** (3 connections) — `scripts/build-wasm.mjs`
- **fichierFactice()** (2 connections) — `scripts/build-wasm.test.mjs`
- **leb128()** (2 connections) — `scripts/build-wasm.test.mjs`
- **MANIFESTE** (1 connections) — `scripts/build-wasm.mjs`
- **RACINE** (1 connections) — `scripts/build-wasm.mjs`
- **SORTIES** (1 connections) — `scripts/build-wasm.mjs`

## Relationships

- [Scripts de build et distribution](Scripts_de_build_et_distribution.md) (4 shared connections)
- [Tests navigateur Node](Tests_navigateur_Node.md) (2 shared connections)
- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (2 shared connections)
- [SDK Node : contrats et progression](SDK_Node_-_contrats_et_progression.md) (1 shared connections)

## Source Files

- `scripts/build-wasm.mjs`
- `scripts/build-wasm.test.mjs`

## Audit Trail

- EXTRACTED: 27 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*