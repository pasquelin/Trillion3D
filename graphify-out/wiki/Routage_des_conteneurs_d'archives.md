# Routage des conteneurs d'archives

> 30 nodes

## Key Concepts

- **route()** (21 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **route.rs** (13 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **prepare_source()** (8 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **project()** (7 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **router.rs** (7 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **routed()** (7 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **claim()** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **Routed** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **RoutedSource** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **route/tests.rs** (5 connections) — `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- **ambiguous()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **scratch()** (4 connections) — `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- **Option** (3 connections)
- **Result** (3 connections)
- **a_directory_holding_only_named_subdirectories_carries_no_source()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- **routed()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- **unknown()** (3 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **HEAD_BYTES** (2 connections) — `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- **a_subdirectory_whose_name_carries_an_extension_is_not_a_source()** (2 connections) — `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- **a_source_claimed_by_two_plugins_is_refused_and_both_are_named()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **an_unknown_source_is_refused_and_the_accepted_formats_are_named()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **fbx_obj_and_manifest_sources_each_go_to_their_own_route()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **gltf_and_glb_sources_select_the_gltf_plugin()** (2 connections) — `packages/asset-compiler-rust/src/plugins/tests/router.rs`
- **Fn** (1 connections)
- **PathBuf** (1 connections)
- *... and 5 more nodes in this community*

## Relationships

- [Verrou CLI et fixtures du compilateur (2)](Verrou_CLI_et_fixtures_du_compilateur_2.md) (7 shared connections)
- [Greffons de scène du compilateur](Greffons_de_scène_du_compilateur.md) (5 shared connections)
- [Bacs à sable des pilotes](Bacs_à_sable_des_pilotes.md) (5 shared connections)
- [tests · compiler_accessor_decode](tests_·_compiler_accessor_decode.md) (3 shared connections)
- [Erreurs du compilateur et USDZ](Erreurs_du_compilateur_et_USDZ.md) (2 shared connections)
- [Import Unity et maillages](Import_Unity_et_maillages.md) (1 shared connections)
- [Verrou CLI et fixtures du compilateur (3)](Verrou_CLI_et_fixtures_du_compilateur_3.md) (1 shared connections)
- [tests · Arc](tests_·_Arc.md) (1 shared connections)
- [Validation du compilateur](Validation_du_compilateur.md) (1 shared connections)
- [unity · PathBuf](unity_·_PathBuf.md) (1 shared connections)

## Source Files

- `packages/asset-compiler-rust/src/plugins/scene/route.rs`
- `packages/asset-compiler-rust/src/plugins/scene/route/tests.rs`
- `packages/asset-compiler-rust/src/plugins/tests/router.rs`

## Audit Trail

- EXTRACTED: 64 (84%)
- INFERRED: 12 (16%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*