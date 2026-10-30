# Internals

The code is the contract: each module's head states its rules and their reasons. Paths are under
`packages/asset-compiler-rust/src/`.

| Stage                  | What it does                                                                                                                                                                                                         | Module                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import                 | Routes each source to its driver; converting drivers write the intermediate glTF under `native/imports/`                                                                                                             | `plugins.rs`, `plugins/scene/convert.rs`                                                                                                                       |
| Scene loading          | Decodes transport compression, keeps the rendered scene's nodes, expands GPU instancing                                                                                                                              | `compiler/source.rs`, `load/compressed.rs`, `source/nodes.rs`, `source/instancing.rs`                                                                          |
| Admission              | Refuses a job above its budget, cuts primitives and images into waves that fit                                                                                                                                       | `compiler/plan.rs`, `compiler/budget.rs`                                                                                                                       |
| Simplification and DAG | Level 0 clusters, then groups simplified with borders locked and re-split, each measured and diagnosed; clusters laid in strips ([How a mesh coarsens](how-a-mesh-coarsens.md#how-a-mesh-coarsens))                                        | `dag.rs`, `dag/`, `src/simplify.rs`, `simplify/region.rs`, `page-codec-wasm/src/partition.rs`, `page-codec-wasm/src/clusters.rs`; corpus `src/tests/corpus.rs` |
| Pages                  | Quantized cluster pages written as delta streams in byte planes ([FORMAT.md](../format/pages.md#pages)), streaming bundles filled by the bytes their pages take in the pool, with closed dependency lists, the paged manifest | `page-codec-wasm/src/encode.rs`, `page-codec-wasm/src/disk.rs`, `pages/dependencies.rs`, `pages/manifest.rs`                                                   |
| Deformation            | Joints, weights, morph targets and soft-body ids carried into the pages with their bounds                                                                                                                            | `page-codec-wasm/src/encode/deformation.rs`, `geometry_page/deform.rs`                                                                                         |
| Coplanar cuts          | One order for surfaces sharing a plane                                                                                                                                                                               | `coplanar.rs`                                                                                                                                                  |
| Textures               | Every mip level, in the stored BC family and the gated ones, keyed by the image's SHA-256                                                                                                                            | `materials/textures.rs`, `src/texture.rs`                                                                                                                      |
| Scene tables           | The node graph, cameras and surfaces the runtime builds its scene from                                                                                                                                               | `compiler/tables.rs`                                                                                                                                           |
| Physics cook           | Colliders, rigid and soft bodies cooked by native Jolt                                                                                                                                                               | `physics_cook.rs`                                                                                                                                              |
| Lights                 | The source's lamps in the engine's contract                                                                                                                                                                          | `compiler/lights.rs`                                                                                                                                           |
| World HLOD             | HLOD 1 to 3: per HLOD cell, its original objects as a textured shell, merged or voxelized, in a DAG                                                                                                                  | `hlod/chain.rs`                                                                                                                                                |
| Identity and reuse     | The cache key; the proof of an existing folder                                                                                                                                                                       | `cache/identity.rs`, `compiler/cache/reuse.rs`                                                                                                                 |
| Publication            | Atomic writes, pointer, prune, cache lock                                                                                                                                                                            | `cache/storage.rs`, `cache/publish.rs`, `cache/prune.rs`, `compiler/cache/lock.rs`                                                                             |

Every platform cooks the same bytes; the root `.cargo/config.toml` and `build.rs` say how.

## `volumetric-lightmap.bin` — the baked indirect light (stage `volumetric-lightmap`)

Written only for a job that names `lightmapBake`, from the scene's geometry and `lights.json`; the
layout is [FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin), the algorithm [Volumetric lightmap](volumetric-lightmap.md#volumetric-lightmap).

## `lights.json` — the lamps of the source file

The source's lamps in world space and the engine's `SceneLight` contract, fields in
[FORMAT.md](../format/lightsjson.md#lightsjson). A point or spot lamp's `emitterRadius` is the radius the source
declares in the light's `extras.emitterRadius`, and none otherwise (`lights/emitter.rs`). A directional light's `extras.shadowDistance` (glTF `KHR_lights_punctual`) is
the sun's shadow distance in metres, a number of at least 0, `false` for none (0), `true` the default;
it is carried into the light of `lights.json` as `shadowDistance`. A value that is none of these is
counted under `light-shadow-distance-invalid` (warning T3D-W219) and left out, the light kept. A light
that is no sun carries none. A spot's `innerConeAngle` and `outerConeAngle` are carried as the file writes
them (glTF: 0 and π/4 where it names none), and a point or a spot's intensity names its unit,
`candelas`.

## `physics.json` — the cooked colliders (stage `physics-cook`)

The browser builds no tree, hull or mass: a primitive's collider is a DAG cut within the object's
own tolerance, tiled on the culling hierarchy, beside height fields, declared matter, rigid bodies
and breakable pieces (`physics_cook.rs`). Fields:
[FORMAT.md](../format/physicsjson-cooked-colliders.md#physicsjson--cooked-colliders).

## Soft bodies a model declares

A node whose `extras.physics` holds `obj.physics`'s soft-body options is cooked as a cloth, rope or
volume rather than static ground, its simulated vertices made as the page makes them, and its drawn
vertices follow the simulation (`physics_cook/soft.rs`, `deform/soft.rs`).
