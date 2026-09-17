# scripts · MANIFESTE

> 12 nodes

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

- [Tests navigateur Node](Tests_navigateur_Node.md) (3 shared connections)
- [Arbre monde et lots de maths](Arbre_monde_et_lots_de_maths.md) (2 shared connections)
- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (2 shared connections)
- [Pages de justesse WebGPU](Pages_de_justesse_WebGPU.md) (1 shared connections)
- [test · steps](test_·_steps.md) (1 shared connections)

## Source Files

- `scripts/build-wasm.mjs`
- `scripts/build-wasm.test.mjs`

## Audit Trail

- EXTRACTED: 27 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*