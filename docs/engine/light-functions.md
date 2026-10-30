# Light functions

A light that wears a light function (`SceneLight.lightFunction`, the id of a `material.lightFunction`
material; `world/material/lightFunctionMaterial.ts`) multiplies its colour, at each point, by what the
material gives there. The material is of the engine's one material system, in the light function domain:
its colour is its emission, `emissive` times `emissiveIntensity` times `emissiveMap` at the projection
coordinate; it reads no world position and no depth, which is what lets the atlas draw it once a
material.

The map is a slot of the materials' colour atlas (`lighting/lightFunction/maps.ts`:
`appendWebgpuTexture`, tiles asked by `warm` at the pixels the slot shows, the slot drawn again till they
are resident). Its record fields are `lightFunction`, `lightFunctionScale` (10.24 m on each axis),
`lightFunctionFadeDistance` (1000 m), `lightFunctionDisabledBrightness` (0.5) and, for a rectangle,
`lightFunctionConeAngle` (0, at most 89 degrees) (`scene/light/lightFunction.ts`). The light's 32 floats
do not grow for it: the light function table's entry the light reads rides in its kind word, in the bits
above the shadow bits (`LIGHT_FUNCTION_SHIFT`; 0, none), set by the frame, not by the host
(`SceneLightStore.assignLightFunction`).

## Planning and the atlas

Each image (`lighting/lightFunction/frame.ts`) plans which lights read which entry (`plan.ts`): the
lights that wear a material, each material once. A limit (`lightFunctionMaxLights`, the atlas's slots)
leaves out the farthest lights, a sun counting as at the eye.

- The table of entries (`entries.ts`, `layout.ts`) holds for each light its fade distance, kind,
  disabled brightness (a half float), the slot's corner and the cone's tangent, and the matrix from the
  world to the light's axes (`up, right, along`, each over its scale).
- The atlas (`atlas.ts`) is one `rgba32uint` texture: the slots on top, the table under them, so that
  every pass reads both through one binding.
- A slot is drawn by a program of its format and of whether the material wears a map (`renderWgsl.ts`),
  over `uv` from 0 to 1 across its texels; it holds the square root of the colour, the grey of its three
  channels or the three (`lightFunctionFormat`). A slot is drawn again when its material is written or
  its map's slot or detail moved; while a map is not read at the detail the slot shows, the held frame
  is drawn (`lightFunctionsWaiting`).

## The read

(`lightFunctionReadWgsl`.) It takes the point to the light's axes and the kind to a coordinate: a spot
`xy / (z tan) / 2 + 1/2`, a rectangle the same when it has a cone, a point light its longitude and
latitude, a sun its axes. The coordinate wraps, the slot is read bilinear and clamped to the slot,
squared, and faded to the disabled brightness by `saturate((fade - distance) / (fade / 5))` from the eye.

Where it is used:

- The opaque lighting multiplies the light's colour by it, diffuse and specular alike (`declaredLight`,
  `declaredLightSplit`).
- The volumetric fog multiplies the sun's colour (by the atlas, or by a texture of its own where the
  atlas does not hold it) and, where `lightFunctionFog` is set, each local light's (`fogSun`,
  `fogLocal`).
- The translucent layers' own lighting reads it where `lightFunctionTranslucent` is set, the
  translucency volume's injection where `lightFunctionDeferred` is.
- The surface cache's light term (`declaredIrradiance`) multiplies what each light adds at a texel by
  the function (`irradianceTerm`): a light the function dims to nothing casts none.
- Where `lightFunctionBounce` is set, the radiance cache's trace (the eye from the cascades' uniform
  `BounceGrid.eye`) and the screen probes' scene trace (`TRACE_SCENE_LIGHT_FUNCTION`: binding 16, the
  view's eye) bind the atlas, a stand-in elsewhere. The probes are traced again (`restart`) when the
  atlas changes (`LightFunctionAtlas.changes`, `lightFunctionRevision`), so a material that reads `time`
  restarts them at each image.
- The reflections' rays evaluate no light: a hit reads the surface cache's lit layer. The clouds' lamps
  take the light as it is.

## Binding totals

The binding is the third storage texture of the translucent layers (a sampled texture elsewhere). The
stage's totals are counted by `gpu/core/stageLimits.test.ts`: 16 of 16 sampled textures, 8 of 8 storage
buffers (the eighth is the lists of the [local fog volumes](fog.md#fog)), 4 of 4 storage textures (the
translucency volume is the fourth, [Transparent surfaces](transparent-surfaces.md#transparent-surfaces)).
The bounce's programs take a sampled texture each:

- the radiance cache's trace 7 of 16 (7 of 8, 1 of 4);
- the screen probes' scene trace 16 of 16 (8 of 8, 3 of 4: the ray words and the probes' points are read
  as the storage textures they are written through, and the surface cache's library is read for its
  depth and its final light alone, `bounce/hitLayouts.test.ts`);
- their temporal pass 15 of 16 (5 of 8, 2 of 4);
- the pool's kernels no sampled texture (5 of 8 storage buffers, 2 of 4 storage textures).
