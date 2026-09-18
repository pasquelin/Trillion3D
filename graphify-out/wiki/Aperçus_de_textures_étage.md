# Aperçus de textures (étage)

> 36 nodes · cohesion 0.10

## Key Concepts

- **rgba_from()** (17 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **stage()** (10 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **texture_preview/tests/mod.rs** (10 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **stage_scene()** (8 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **tail_of()** (8 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **bake_files.rs** (7 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **each_level_is_the_exact_2x2_average_of_the_previous_one()** (7 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **a_level_that_cannot_be_written_keeps_the_tail_and_bakes_nothing()** (5 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **levels_above_the_tail_are_written_once_per_atlas_as_lossless_png()** (5 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **odd_dimensions_reduce_without_panicking()** (5 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **level_size()** (5 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **atlas_rule.rs** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/atlas_rule.rs`
- **a_small_image_bakes_nothing_to_disk()** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **an_existing_level_file_is_left_untouched()** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **box_reduce.rs** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **tests/levels.rs** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- **level_bytes()** (4 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`
- **scene_with_two_readers()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- **a_source_under_the_base_carries_its_own_full_resolution()** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- **median_alpha.rs** (3 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/median_alpha.rs`
- **a_transparent_texel_color_enters_the_mean_as_on_the_card()** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/atlas_rule.rs`
- **each_level_is_derived_from_the_quantized_previous_level()** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/atlas_rule.rs`
- **the_same_bytes_reduce_differently_for_each_atlas()** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/atlas_rule.rs`
- **Value** (2 connections)
- **the_srgb_curve_round_trips_every_byte()** (2 connections) — `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- *... and 11 more nodes in this community*

## Relationships

- [Aperçus de textures (étage) (3)](Aperçus_de_textures_étage_3.md) (9 shared connections)
- [Budget et ouvriers du compilateur](Budget_et_ouvriers_du_compilateur.md) (7 shared connections)
- [Aperçus de textures et pyramide](Aperçus_de_textures_et_pyramide.md) (6 shared connections)
- [Identité du compilateur et purge](Identité_du_compilateur_et_purge.md) (2 shared connections)
- [Aperçus de textures (étage) (2)](Aperçus_de_textures_étage_2.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/texture_preview/tests/atlas_rule.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/bake_files.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/box_reduce.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/levels.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/median_alpha.rs`
- `packages/asset-compiler-rust/src/texture_preview/tests/mod.rs`

## Audit Trail

- EXTRACTED: 52 (60%)
- INFERRED: 34 (40%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*