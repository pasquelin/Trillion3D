# Lights imported from the source file

The compiler writes a source file's lights beside the manifest as `lights.json`
([COMPILER.md](../../compiler/internals.md#lightsjson--the-lamps-of-the-source-file)): glTF from
`KHR_lights_punctual`, FBX through ufbx, USD from the `UsdLux` sphere, disk, rect and distant
schemas, Blender from `Lamp` blocks; OBJ declares none. Positions and directions are world space,
after instancing: a light instanced by three nodes is three entries.

**Units.** glTF's values (candela for `point` and `spot`, lux for `directional`) are the engine's
`intensity` as they stand: no luminous efficacy divides them, no hidden gain, and the exposure maps
the number to the picture. FBX's `Intensity`, a percentage, converts at **1000 lm / 4π ≈ 79.6 cd** for a point or
spot and **10 000 lux** for a directional. A `point` or `spot` without `range` gets
an unbounded one (1e20 m, as glTF defines it: the light reaches every cell of the light grid); a declared `range` is kept
as written, with no ceiling. A spot keeps the `innerConeAngle` and `outerConeAngle` the
file writes (glTF's defaults, 0 and π/4, where it names none), and a point or spot names its unit,
`candelas`. A light breaking
the contract is counted in `rejected` and left out.

A light casts when the file says so (glTF says nothing, so imported glTF lights cast). Every light
is read as `(await scene.load(url)).lights` in cache order (`imported-lights` counts them), each a
child of the model, changed like any light. A cache without `lights.json` has none.
