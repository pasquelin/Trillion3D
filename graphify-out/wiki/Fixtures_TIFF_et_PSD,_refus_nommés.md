# Fixtures TIFF et PSD, refus nommés

> 23 nodes · cohesion 0.09

## Key Concepts

- **tests/psd.rs** (15 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **tests/tiff.rs** (10 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **TIFF est un conteneur de champs : profils déclarés un par un, le reste refusé en le nommant** (4 connections) — `packages/asset-compiler-rust/fixtures/tiff/README.md`
- **Fixture dorée — pilote TIFF** (3 connections) — `packages/asset-compiler-rust/fixtures/tiff/README.md`
- **Refus du 16 bits avant décodage (image-depth-unsupported)** (2 connections) — `packages/asset-compiler-rust/fixtures/png/README.md`
- **Le plan de plus : canal alpha enregistré (sélection) ≠ transparence du document** (2 connections) — `packages/asset-compiler-rust/fixtures/psd/README.md`
- **le_plafond_dallocation_compte_quatre_octets_par_pixel()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **un_entete_hors_domaine_est_refuse_par_son_nom()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **Licence CC0-1.0 — fixture tiff** (1 connections) — `packages/asset-compiler-rust/fixtures/tiff/LICENSE.txt`
- **ALPHA** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **avec_alpha()** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **GRIS** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **les_deux_ecritures_du_composite_rendent_les_pixels_de_la_reference()** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **MAX_ALLOC** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **RVB** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **SIZE** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- **ALPHA** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **chaque_profil_tiff_declare_rend_les_pixels_de_la_reference()** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **COULEURS** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **GRIS** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **MAX_ALLOC** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **rendus()** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`
- **un_tiff_hors_profil_ressort_en_raison_de_rapport_jamais_en_panique()** (1 connections) — `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`

## Relationships

- [ktx2 · NAMES](ktx2_·_NAMES.md) (2 shared connections)
- [tests · HEADER](tests_·_HEADER.md) (2 shared connections)
- [tests · gamma](tests_·_gamma.md) (1 shared connections)
- [Fixtures dorées KTX2, PNG, TGA](Fixtures_dorées_KTX2,_PNG,_TGA.md) (1 shared connections)
- [Banc de mesure : options et compteurs](Banc_de_mesure_-_options_et_compteurs.md) (1 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (1 shared connections)
- [Tests du pilote GIF](Tests_du_pilote_GIF.md) (1 shared connections)
- [Tests du pilote GIF (2)](Tests_du_pilote_GIF_2.md) (1 shared connections)
- [Politiques APNG, PSD et WebP](Politiques_APNG,_PSD_et_WebP.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/fixtures/png/README.md`
- `packages/asset-compiler-rust/fixtures/psd/README.md`
- `packages/asset-compiler-rust/fixtures/tiff/LICENSE.txt`
- `packages/asset-compiler-rust/fixtures/tiff/README.md`
- `packages/asset-compiler-rust/src/plugins/tests/psd.rs`
- `packages/asset-compiler-rust/src/plugins/tests/tiff.rs`

## Audit Trail

- EXTRACTED: 28 (85%)
- INFERRED: 5 (15%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*