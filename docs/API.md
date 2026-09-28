# Trillion3D public API reference

The [SDK guide](SDK.md) explains the public `trillion3d` entry points and how to
create a world. These material methods belong to the `world` returned by
`createWorld` in a browser, after its scene has opened a drawing session.

| Method                                       | Result                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `world.materials()`                          | Current imported and page-created `SceneMaterial[]`, as detached copies.                             |
| `world.material(id)`                         | One current `SceneMaterial` by its listed string ID; raises `UNKNOWN_MATERIAL` for an absent ID.     |
| `world.importedMaterials()`                  | Detached copies of the source file's original materials, unaffected by page edits.                   |
| `world.setMaterial(id, patch)`               | Edits supported values for the next frame; returns whether every renderer took the change in place.  |
| `world.createMaterial(props?)`               | Creates and returns a page-owned `SceneMaterial`; at most 256 per session.                           |
| `world.assignMaterial('mesh/primitive', id)` | Puts a created material on a compiled primitive and returns whether every renderer took it in place. |

`SceneMaterial` has `id`, `name`, `baseColor`, `opacity`, `metalness`, `roughness`,
`emissive`, `side`, `alphaMode`, `alphaCutoff` and `tiling`. The patch takes
`baseColor`, `opacity`, `metalness`, `roughness`, `emissive`, `alphaMode`,
`alphaCutoff` and `tiling`; creation also takes `name` but no `tiling` or map.
See [Page materials](SDK.md#page-materials) for value ranges, class changes and
named refusals, and the [runnable example](../site/examples/page-materials.html).
