# Politiques APNG, PSD et WebP

> 14 nodes · cohesion 0.15

## Key Concepts

- **tests/webp.rs** (10 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`
- **Fixture dorée — pilote PSD et PSB (composite aplati)** (5 connections) — `packages/asset-compiler-rust/fixtures/psd/README.md`
- **rendu()** (4 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`
- **Fixture dorée — pilote WebP, sans perte uniquement** (3 connections) — `packages/asset-compiler-rust/fixtures/webp/README.md`
- **Politique WebP : sans perte uniquement, le flux avec perte est refusé en le nommant** (3 connections) — `packages/asset-compiler-rust/fixtures/webp/README.md`
- **APNG : l'image par défaut sort, l'animation est comptée (image-animation-first-frame)** (2 connections) — `packages/asset-compiler-rust/fixtures/png/README.md`
- **Politique PSD : le composite aplati seulement, jamais de calques recomposés** (2 connections) — `packages/asset-compiler-rust/fixtures/psd/README.md`
- **les_deux_ecritures_du_sans_perte_rendent_les_memes_octets()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`
- **Refus PSD nommés : depth, color-mode (CMJN), channels, compression (ZIP), composite-missing, data-truncated, header-invalid** (1 connections) — `packages/asset-compiler-rust/fixtures/psd/README.md`
- **Licence CC0-1.0 — fixture webp** (1 connections) — `packages/asset-compiler-rust/fixtures/webp/LICENSE.txt`
- **MAX_ALLOC** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`
- **MAX_ALLOC_TROP_PETIT** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`
- **RgbaImage** (1 connections)
- **TEXELS** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/webp.rs`

## Relationships

- [Fixtures dorées KTX2, PNG, TGA](Fixtures_dorées_KTX2,_PNG,_TGA.md) (3 shared connections)
- [Fixtures TIFF et PSD, refus nommés](Fixtures_TIFF_et_PSD,_refus_nommés.md) (1 shared connections)
- [Exécution des tests dorés](Exécution_des_tests_dorés.md) (1 shared connections)
- [ktx2 · NAMES](ktx2_·_NAMES.md) (1 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (1 shared connections)
- [Tests du pilote GIF (2)](Tests_du_pilote_GIF_2.md) (1 shared connections)
- [Tests du pilote GIF](Tests_du_pilote_GIF.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/fixtures/png/README.md`
- `packages/asset-compiler-rust/fixtures/psd/README.md`
- `packages/asset-compiler-rust/fixtures/webp/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/webp/README.md`
- `packages/asset-compiler-rust/src/plugins/tests/webp.rs`

## Audit Trail

- EXTRACTED: 20 (87%)
- INFERRED: 3 (13%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*