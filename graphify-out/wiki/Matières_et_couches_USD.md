# Matières et couches USD

> 32 nodes

## Key Concepts

- **usd_matiere.rs** (14 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **texture()** (9 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **layer()** (7 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **usd_surface.rs** (7 connections) — `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- **usd_textures.rs** (7 connections) — `packages/asset-compiler-rust/src/tests/usd_textures.rs`
- **compile_files()** (7 connections) — `packages/asset-compiler-rust/src/tests/usd_textures.rs`
- **compile()** (6 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **carried_by()** (5 connections) — `packages/asset-compiler-rust/src/tests/usd_opacite.rs`
- **write_under()** (5 connections) — `packages/asset-compiler-rust/src/tests/usd_textures.rs`
- **a_metal_roughness_input_bound_to_another_channel_is_counted_by_its_name()** (4 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **a_shared_metal_roughness_texture_wins_over_the_factors_instead_of_being_cancelled_by_them()** (4 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **an_opacity_bound_to_the_base_colour_texture_reaches_the_alpha_and_the_blend_mode()** (4 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **usd_opacite.rs** (4 connections) — `packages/asset-compiler-rust/src/tests/usd_opacite.rs`
- **an_opacity_carried_by_a_second_image_is_counted_rather_than_loaded_and_dropped()** (3 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **unsupported()** (3 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **a_texture_of_a_referenced_layer_resolves_against_the_directory_of_that_layer()** (3 connections) — `packages/asset-compiler-rust/src/tests/usd_textures.rs`
- **the_wrap_scale_bias_and_colour_space_of_a_uv_texture_are_carried_or_counted()** (3 connections) — `packages/asset-compiler-rust/src/tests/usd_textures.rs`
- **pbr()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- **String** (2 connections)
- **Value** (2 connections)
- **only_the_alpha_channel_of_the_base_colour_texture_carries_the_opacity()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_opacite.rs`
- **a_preview_surface_that_writes_nothing_carries_the_values_of_the_specification()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- **a_textured_occlusion_reaches_the_occlusion_texture_through_its_red_channel()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- **material()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- **what_gltf_has_no_place_for_in_a_preview_surface_is_counted_by_its_name()** (2 connections) — `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- *... and 7 more nodes in this community*

## Relationships

- [tests · compiler_accessor_decode](tests_·_compiler_accessor_decode.md) (4 shared connections)
- [Exécution des tests dorés](Exécution_des_tests_dorés.md) (4 shared connections)
- [Pilote USD et fidélité](Pilote_USD_et_fidélité.md) (4 shared connections)
- [Tests dorés du compilateur](Tests_dorés_du_compilateur.md) (1 shared connections)
- [Bacs à sable des pilotes (2)](Bacs_à_sable_des_pilotes_2.md) (1 shared connections)
- [Verrou CLI et fixtures du compilateur (2)](Verrou_CLI_et_fixtures_du_compilateur_2.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/tests/usd_matiere.rs`
- `packages/asset-compiler-rust/src/tests/usd_opacite.rs`
- `packages/asset-compiler-rust/src/tests/usd_surface.rs`
- `packages/asset-compiler-rust/src/tests/usd_textures.rs`

## Audit Trail

- EXTRACTED: 57 (85%)
- INFERRED: 10 (15%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*