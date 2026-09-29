# Trillion3D public API reference

The [SDK guide](SDK.md) explains the public `trillion3d` entry points and how to
create a world. These material methods belong to the `world` returned by
`createWorld` in a browser, after its scene has opened a drawing session.

| Method                                       | Result                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `world.materials()`                          | Current imported and page-created `SceneMaterial[]`, as detached copies.                                     |
| `world.material(id)`                         | One current `SceneMaterial` by its listed string ID; raises `UNKNOWN_MATERIAL` for an absent ID.             |
| `world.importedMaterials()`                  | Detached copies of the source file's original materials, unaffected by page edits.                           |
| `world.setMaterial(id, patch)`               | Edits supported values for the next frame; returns whether every renderer took the change in place.          |
| `world.createMaterial(props?)`               | Creates a page-owned material (at most 256); with an `ImageBitmap` map, await its promise before assignment. |
| `world.dropMaterial(id)`                     | Releases an unused created material and its map; assigned materials refuse until replaced.                   |
| `world.materialMapBytes()`                   | Runtime map bytes held or pending, under the fixed 64 MiB ceiling (`TEXTURE_BUDGET`).                        |
| `world.assignMaterial('mesh/primitive', id)` | Puts a created material on a compiled primitive and returns whether every renderer took it in place.         |

`SceneMaterial` has `id`, `name`, `baseColor`, `opacity`, `metalness`, `roughness`,
`emissive`, `side`, `alphaMode`, `alphaCutoff` and `tiling`. The patch takes
`baseColor`, `opacity`, `metalness`, `roughness`, `emissive`, `alphaMode`,
`alphaCutoff` and `tiling`; creation also takes `name` but no `tiling` or map.
See [Page materials](SDK.md#page-materials) for value ranges, class changes and
named refusals, and the [runnable example](../site/examples/page-materials.html).

A geometry rewritten every frame declares `geometry.usage = 'dynamic'` (default `'static'`), and
may declare `geometry.maxBounds`, the `Box3` its vertices never leave; each frame's
`metrics.dynamicUploadBytes` is what it uploaded, within `DYNAMIC_UPLOAD_BUDGET_BYTES`. See
[Geometry rewritten every frame](SDK.md#geometry-rewritten-every-frame).

The `animation` export controls imported and page-created deformation:

| API | Result |
| --- | --- |
| `animation.createMixer(root)` | Mixer whose clips bind to names below `root`. |
| `mixer.clipAction(clip)` | Action with `play()`, `stop()`, `seek(seconds)`, `weight`, `timeScale` and `blendMode`. |
| `animation.weightsTrack(path, times, values)` | Track of all morph weights at each key. |
| `animation.skeleton(bones, inverseBindMatrices?)` | Skeleton assigned to `mesh.skeleton`; omitted matrices use the current bind pose. |
| `animation.twoBoneIK(root, mid, end, target, pole?, weight?)` | Solves the named two-bone chain after clip sampling. |
| `animation.windClip(bones, options?)` | Looping wind clip of bone rotations. |
| `mesh.waves = waterSurface` | Uses that physics surface's wave model for rendering. |
| `metrics.gpuDeformationMs` | Latest GPU stage duration in milliseconds, or `null` without a timestamp sample. |

See [GPU deformation](SDK.md#gpu-deformation) for the geometry attributes, blending and examples.
