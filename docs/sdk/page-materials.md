# Page materials

Once `await world.awaitPages()` has opened the drawing session, a page reads and edits a loaded
model's materials through its `world`:

| Call                                         | Result                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.materials()`                          | `SceneMaterial[]`, cache table order then the page's, as detached copies (`id`, `name`, `baseColor`, `opacity`, `metalness`, `roughness`, `emissive`, `side`, `alphaMode`, `alphaCutoff`, `tiling`, `null` without a map) |
| `world.material(id)`                         | one by listed ID; an unknown ID raises `UNKNOWN_MATERIAL`                                                                                                                                                                 |
| `world.importedMaterials()`                  | the source file's values, whatever the page changed; created materials excluded                                                                                                                                           |
| `world.setMaterial(id, patch)`               | every surface built from it, next frame; `true` if it was applied in place, `false` if one needs a new session                                                                                                            |
| `world.createMaterial(props?)`               | a page-owned material, at most 256 per session (`MATERIAL_CEILING` past it, nothing created)                                                                                                                              |
| `world.dropMaterial(id)`                     | releases an unused created material, its variants, map and accounted bytes                                                                                                                                                |
| `world.materialMapBytes()`                   | runtime map bytes held and pending, under the fixed 64 MiB ceiling                                                                                                                                                        |
| `world.assignMaterial('mesh/primitive', id)` | a created material on a compiled primitive, numbers from `metadata.primitives`; unknown: `UNKNOWN_SCENE_NODE`                                                                                                             |

A patch sets `baseColor` (linear, 0 to 1), `opacity`, `metalness`, `roughness`, `alphaCutoff` (0 to
1), linear `emissive` (nonnegative), `alphaMode` (`'opaque'`, `'mask'`, `'blend'`) or nonzero
`tiling`, which needs a map only that material uses (`MATERIAL_TEXTURE_SHARED`); an invalid one
raises `INVALID_MATERIAL` before any write. A change that cannot move drawables between opaque,
masked and blended in place raises `MATERIAL_CLASS_CHANGE` first.

`world.createMaterial({ name?, baseColor?, opacity?, metalness?, roughness?, emissive?, alphaMode?,
alphaCutoff?, map? })` returns its record; with an `ImageBitmap` `map`, a promise to await before
assignment, a failed upload publishing nothing. The bitmap is borrowed: decode it with
`premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'`, and close it once the material is
dropped or the session disposed. Each material owns its texture. Runtime maps have a fixed 64 MiB
decoded RGBA ceiling, checked before allocation (`TEXTURE_BUDGET`). `tiling` is set-only. Dropping
an assigned material raises `UNSUPPORTED_SCENE_UPDATE`: assign a replacement first. Dropped IDs are
never reused.
