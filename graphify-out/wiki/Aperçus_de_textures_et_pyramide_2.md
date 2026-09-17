# Aperçus de textures et pyramide (2)

> 17 nodes

## Key Concepts

- **rgba_from()** (11 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **level_bytes()** (9 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **each_level_is_the_exact_2x2_average_of_the_previous_one()** (6 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **odd_dimensions_reduce_without_panicking()** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **tests/levels.rs** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **box_reduce.rs** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **a_source_under_the_base_carries_its_own_full_resolution()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **mask_coverage.rs** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mask_coverage.rs`
- **alpha_is_unchanged_without_a_mask_cutoff()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mask_coverage.rs`
- **a_hard_edge_does_not_bleed_the_transparent_side_color_into_the_opaque_side()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/pyramid_bleed.rs`
- **le_meme_octet_declare_srgb_puis_lineaire_ne_donne_pas_le_meme_apercu()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/transfert.rs`
- **linear()** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **pyramid_bleed.rs** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/pyramid_bleed.rs`
- **tests/transfert.rs** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/transfert.rs`
- **geometry_matches_expectations_for_a_non_square_and_a_maximal_texture()** (1 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **Fn** (1 connections)
- **RgbaImage** (1 connections)

## Relationships

- [Aperçus de textures et pyramide](Aperçus_de_textures_et_pyramide.md) (7 shared connections)
- [tests · compiler_accessor_decode](tests_·_compiler_accessor_decode.md) (5 shared connections)
- [Aperçus de textures (étage)](Aperçus_de_textures_étage.md) (3 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/mask_coverage.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/pyramid_bleed.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/transfert.rs`

## Audit Trail

- EXTRACTED: 20 (53%)
- INFERRED: 18 (47%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*