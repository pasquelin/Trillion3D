# Internals

Paths are under `packages/asset-compiler-rust/src/`.

| Stage | What it does | Module |
| --- | --- | --- |
| Import | Sources to drivers; converters write glTF under `native/imports/` | `plugins.rs`, `plugins/scene/convert.rs` |
| Scene loading | Decompression, rendered nodes, GPU instancing | `compiler/source.rs`, `load/compressed.rs`, `source/nodes.rs`, `source/instancing.rs` |
| Admission | Refuses a job above budget; waves | `compiler/plan.rs`, `compiler/budget.rs` |
| Simplification and DAG | Level 0 clusters, groups simplified (borders locked) and re-split ([How a mesh coarsens](how-a-mesh-coarsens.md#how-a-mesh-coarsens)) | `dag.rs`, `dag/`, `src/simplify.rs`, `simplify/region.rs`, `page-codec-wasm/src/partition.rs`, `page-codec-wasm/src/clusters.rs`; corpus `src/tests/corpus.rs` |
| Pages | Quantized cluster pages, delta byte planes ([FORMAT.md](../format/pages.md#pages)), bundles, paged manifest | `page-codec-wasm/src/encode.rs`, `page-codec-wasm/src/disk.rs`, `pages/dependencies.rs`, `pages/manifest.rs` |
| Deformation | Joints, weights, morph targets, soft-body ids, bounds | `page-codec-wasm/src/encode/deformation.rs`, `geometry_page/deform.rs` |
| Coplanar cuts | Order of coplanar surfaces | `coplanar.rs` |
| Textures | Every mip, BC family plus gated ones, keyed by image SHA-256 | `materials/textures.rs`, `src/texture.rs` |
| Scene tables | Nodes, cameras, surfaces | `compiler/tables.rs` |
| Physics cook | Colliders, rigid and soft bodies (Jolt) | `physics_cook.rs` |
| Lights | Source lamps | `compiler/lights.rs` |
| World HLOD | HLOD 1 to 3: per cell, original objects as textured shell, merged or voxelized | `hlod/chain.rs` |
| Identity and reuse | Cache key; proof of an existing folder | `cache/identity.rs`, `compiler/cache/reuse.rs` |
| Publication | Atomic writes, pointer, prune, lock | `cache/storage.rs`, `cache/publish.rs`, `cache/prune.rs`, `compiler/cache/lock.rs` |

Every platform cooks the same bytes (root `.cargo/config.toml`, `build.rs`).

## `volumetric-lightmap.bin` — the baked indirect light (stage `volumetric-lightmap`)

Written only for a job naming `lightmapBake`; layout:
[FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin), algorithm:
[Volumetric lightmap](volumetric-lightmap.md#volumetric-lightmap).

## `lights.json` — the lamps of the source file

World-space `SceneLight`s, fields in [FORMAT.md](../format/lightsjson.md#lightsjson).

- Point or spot `emitterRadius` is the light's `extras.emitterRadius`, none otherwise
  (`lights/emitter.rs`).
- Directional `extras.shadowDistance` (glTF `KHR_lights_punctual`): metres, number at least 0,
  `false` none (0), `true` default; carried as `shadowDistance`. Other value: counted under
  `light-shadow-distance-invalid` (warning T3D-W219), left out, light kept. Non-sun lights: none.
- Spot `innerConeAngle`, `outerConeAngle` carried as written (glTF defaults 0 and π/4); point and
  spot intensity unit is `candelas`.

## `physics.json` — the cooked colliders (stage `physics-cook`)

Primitive collider: DAG cut within the object's tolerance, tiled on the culling hierarchy, beside
height fields, declared matter, rigid bodies, breakable pieces (`physics_cook.rs`). Fields:
[FORMAT.md](../format/physicsjson-cooked-colliders.md#physicsjson--cooked-colliders).

## Soft bodies a model declares

A node whose `extras.physics` holds `obj.physics`'s soft-body options is cooked as cloth, rope or
volume (`physics_cook/soft.rs`, `deform/soft.rs`).
