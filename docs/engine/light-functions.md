# Light functions

A light with a light function (`SceneLight.lightFunction`, id of a `material.lightFunction` material;
`world/material/lightFunctionMaterial.ts`) multiplies its colour per point by the material. Material
colour = `emissive` × `emissiveIntensity` × `emissiveMap` at the projection coordinate; no world
position, no depth; drawn once per material.

The map is a slot of the materials' colour atlas (`lighting/lightFunction/maps.ts`:
`appendWebgpuTexture`; tiles asked by `warm`). Fields: `lightFunction`, `lightFunctionScale` (10.24 m per axis),
`lightFunctionFadeDistance` (1000 m), `lightFunctionDisabledBrightness` (0.5), and for a rectangle
`lightFunctionConeAngle` (0, at most 89 degrees) (`scene/light/lightFunction.ts`). The table entry
index rides in the light's kind word above the shadow bits (`LIGHT_FUNCTION_SHIFT`; 0 = none), set by
the frame (`SceneLightStore.assignLightFunction`).

## Planning and the atlas

Each image (`lighting/lightFunction/frame.ts`, `plan.ts`) maps lights to entries, one per material.
`lightFunctionMaxLights` (atlas slots) drops the farthest lights; a sun counts as at the eye.

- Table entries (`entries.ts`, `layout.ts`) per light: fade distance, kind, disabled brightness
  (half float), slot corner, cone tangent, world-to-light-axes matrix (`up, right, along`, each
  over its scale).
- Atlas (`atlas.ts`): one `rgba32uint` texture, slots on top, table under.
- A slot (`renderWgsl.ts`, over `uv` 0 to 1 across its texels) holds the square root of the colour,
  grey or three channels (`lightFunctionFormat`); redrawn when its material or map changes; the held frame is drawn while
  a map is not resident (`lightFunctionsWaiting`).

## The read

(`lightFunctionReadWgsl`.) Point goes to light axes, kind to a coordinate: spot
`xy / (z tan) / 2 + 1/2`, rectangle the same with a cone, point light longitude/latitude, sun its
axes. Wraps; slot read bilinear, clamped, squared, faded to the disabled brightness by
`saturate((fade - distance) / (fade / 5))` from the eye.

Used by:

- Opaque lighting, diffuse and specular (`declaredLight`, `declaredLightSplit`).
- Volumetric fog: sun (`fogSun`; atlas, or own texture); local lights (`fogLocal`) where
  `lightFunctionFog` is set.
- Translucent layers where `lightFunctionTranslucent` is set; translucency volume injection where
  `lightFunctionDeferred` is.
- Surface cache light term (`declaredIrradiance`, `irradianceTerm`): a light the function dims to
  nothing casts none.
- Where `lightFunctionBounce` is set: radiance cache trace (eye: cascades' uniform `BounceGrid.eye`)
  and screen probes' scene trace (`TRACE_SCENE_LIGHT_FUNCTION`, binding 16). Probes retrace
  (`restart`) when the atlas changes (`LightFunctionAtlas.changes`, `lightFunctionRevision`); a
  material reading `time` restarts them each image.
- Not used: reflection rays; clouds' lamps.

## Binding totals

Stage totals (`gpu/core/stageLimits.test.ts`): 16 of 16 sampled textures, 8 of 8 storage buffers (the
eighth: [local fog volumes](fog.md#fog) lists), 4 of 4 storage textures (the fourth: translucency
volume, [Transparent surfaces](transparent-surfaces.md#transparent-surfaces)). Bounce programs:

- radiance cache trace 7 of 16 (7 of 8, 1 of 4);
- screen probes' scene trace 16 of 16 (8 of 8, 3 of 4; `bounce/hitLayouts.test.ts`);
- their temporal pass 15 of 16 (5 of 8, 2 of 4);
- pool kernels: none sampled (5 of 8, 2 of 4).
