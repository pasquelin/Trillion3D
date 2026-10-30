# Single-layer water

A lit surface whose material graph wires any of the four water outputs (`scatteringCoefficients`,
`absorptionCoefficients`, `phaseG`, `colorScaleBehindWater`, the first two per centimetre) is a body of water seen through
one layer. It is drawn over the opaque scene, after the lights and before every translucent layer, in the passes the
reference's single-layer water has: the scene without the water is copied (its depth as the distance along the view, its
colour), the water's depth is drawn first, then the water is shaded over the copy — its surface lit by the declared lights
as a physical surface, the base material's colour under the coverage its `opacity` output gives (1: the base material
only, 0: pure water), the volume between the surface and the scene behind it integrated analytically — and last the
reflection of the surface is added. The volume is the sun's in-scattering (a phase function of `phaseG` in the direction
the refraction bends the view to; the sun is the forward directional light) and the ambient light's, over the share of the
light the volume scatters before it absorbs it, less the Fresnel reflectance of the surface; what lies behind is read
where the surface refracts it (the surface normal bent by the index of refraction, from the surface's `specular`, or the
`refraction` output when it is wired), dimmed by the colour absorption over the depth of water and by the fall from the
scene to the water's height, and multiplied by `colorScaleBehindWater`. The reflection is the transparents' front
layer's trace — the engine's reflection of the nearest transparent surface, traced as the opaque one is — weighed on the
surface's reflectance, faded in over the first 50 cm of water above the scene, always traced for the water whatever
`reflectionFrontLayer` says (at every level that traces reflections). The water's depth becomes the scene's: fog,
particles and the transparents drawn after are hidden behind it.

## Reflection hit lighting

Options of the reflections (`packages/sdk-core/src/contracts/hitLightingOptions.ts`), each with the reference's default. A reflection ray that meets the scene's
triangles reads the light the surface cache holds at the hit. With `reflectionHardwareRayTracingHitLighting: true` the hits the cache cannot light (no card gave any
light) are collected, sorted by material (`reflectionHardwareRayTracingBucketMaterials`, on; the key is a hash of what makes the shading of a material differ) and lit where they stand: the hit's own material
under the scene's lights (`hardwareRayTracingHitLightingDirectLighting` on): its whole response toward the eye, the diffuse and the specular lobe, times a shadow ray each
(`hardwareRayTracingHitLightingShadowMode` `'off'`, `'hard'` or `'soft'`), plus the emitted light and the indirect light: the surface cache's, or the sky light's irradiance with
`hardwareRayTracingHitLightingSkylight: 'on'`, where `hardwareRayTracingHitLightingReflectionCaptures: true` makes the specular share the material's reflectance on the sky light's filtered cube along the reflected ray.
With the direct lighting off and no sky light the surface cache's own light is read as it stands; off with the sky light, the hit has the sky light's terms alone.
`hardwareRayTracingLightingMode: 'hitLighting'` (or `'hitLightingForReflections'`) lights every hit of the reflections this way; `'hitLighting'` alone also lights, this way, the hits of the screen probes' rays (`screenProbeHardwareRayTracing`) and of the radiance cache's rays (the other two modes keep the surface cache for them); `hardwareRayTracingHitLightingAllowed` (on) is the switch that
forbids it all; `hardwareRayTracingHitLightingForceOpaque` (off) makes the trace that meets the hit again skip the masks' any-hit test; `hardwareRayTracingHitLightingShadowTranslucencyMode`
sets what the shadow rays cut: `'opaque'` every surface, `'masked'` (the default) the masked ones by their alpha and none of the translucent ones, `'fractional'` the masked ones and, through the translucent ones, the share their coverage lets through.

```js
const world = await createWorld({
  reflections: {
    reflectionHardwareRayTracingHitLighting: true,
    hardwareRayTracingHitLightingShadowMode: 'hard',
  },
})
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // every hit lit where it stands, from the next frame
```

The lights a hit is lit by are found through a light grid, as the reference's ray-traced lighting finds them: the box that holds the reach of the local lights (points, spots, rectangles) is cut in `rayTracingLightGridResolution` (256, 1 to 2048)
cells a side seen along each of the three axes, each cell keeps the lights whose reach overlaps it (a spot by its cone, a light facing away from the cell not at all) up to `rayTracingLightGridMaxCount` (128, 1 to 65536; at most the number of local lights),
and a hit loops over the suns, which every hit sees, and the lights of its cell. `rayTracingLightGridAxis` (-1) picks, cell by cell, the axis whose cell keeps the fewest lights; 0, 1 or 2 forces the axis. The lights are kept by type (points, spots, rectangles) and every light of the scene is in the grid, whichever the distance of the view (a light the view's draw range leaves out lights the hits all the same). A cell that more lights overlap than it keeps is marked as overflowing and a hit in it loops over every light, so no light is lost (the reference stops such a cell at its limit and loses the lights past it, a declared fix); raise `rayTracingLightGridMaxCount` for a scene where many lights overlap, to keep the lists short. The grid is built again only when the lights change, and where it does not fit the device or the memory budget every light is looped over. A rectangle's barn doors are not in the engine's lights, so the grid does not cull by them.

```js
world.reflections = { rayTracingLightGridResolution: 128, rayTracingLightGridMaxCount: 256 } // a coarser grid keeping more lights a cell
```

With `hardwareRayTracingLightingMode: 'hitLighting'` the rays of the screen probes (`screenProbeHardwareRayTracing`, with the scene's triangles traced) light their hits the same way: the stage that casts them marks each hit on a triangle with the key of its material,
the marks are collected and sorted by material (`reflectionHardwareRayTracingBucketMaterials`), and the hit is lit where it stands — the material, the lights and their shadow rays, the sun's shadow ray running as far as `screenProbeMaxTraceDistance` — plus the surface cache's indirect light
(or the sky light's, `hardwareRayTracingHitLightingSkylight: 'on'`), the sky light that leaks onto the hit and the height fog laid over the ray. The probes' rays have one bounce, no refraction and no reflection capture whatever `reflectionMaxBounces`
and the other path settings say; a hit on the back of a surface that is not two-sided ends the ray with no light. The buffers hold 80 bytes for each ray of the view (8 for its entry in the list of hits, 8 for its sorted copy and 64 for the radiance of its path); where the radiance no longer fits one storage binding of the device the mode is refused with a line in the console, and where the device's memory budget leaves no room for the buffers the probes keep the surface cache's light for the image, the mode staying as set.

```js
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // reflections and screen probes alike
```

The radiance cache's rays light their hits the same way (`screenProbeRadianceCacheHardwareRayTracing`, with the scene's triangles traced; the same `'hitLighting'` mode, the other two keep the surface cache's light): the trace marks each hit on a triangle with the key of its material, the marks of a slice of the cache's tile list
are collected, sorted by material (`reflectionHardwareRayTracingBucketMaterials`) and lit where they stand — the material, the lights and their shadow rays, the sun's shadow ray running as far as `screenProbeMaxTraceDistance`, the surface cache's indirect light or the sky light's — then the sky light that leaks
onto the hit is added where the cache makes irradiance maps and the sum is written to the trace atlas under the cache's pre-exposure. No face is culled in the cache's trace; a hit on the back of a surface that is not two-sided ends the ray with no light, as in the reference. The cache's rays have one bounce, no refraction and no reflection capture
whatever `reflectionMaxBounces` and the other path settings say. The slices are as many tiles as the rays' radiance (64 bytes a ray, the largest of the 80 the lists hold) fits in a storage binding of the device, so a very large update takes more slices and never refuses the mode; the maps held are traced anew when the mode turns on or off.

```js
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // the screen probes' rays and the radiance cache's, lit where they hit
world.indirectLight = { screenProbeRadianceCacheHardwareRayTracing: true } // the cache casts through the scene's triangles (its default)
```

`reflectionMaxBounces` (1, from 1 to 64) is the most reflection rays a path of the hit lighting has. With 1 the reflection ray stops at the first lit hit; with more, the path goes on from each
lit hit along the reflection of its own specular lobe (a visible normal of the lobe drawn by the frame's noise), weighed by the top layer's reflectance met (the environment BRDF of the specular colour toward the eye), so that a mirror seen in a mirror shows
the room and not only the surface cache; each hit of the path is lit as the first (the lights, the sky light, the cache's indirect light) and a ray that leaves the scene reads the sky.
The path ends where the roughness it has accumulated is past what the reflections trace (`reflectionMaxRoughnessToTrace` and its fade), the specular light the next ray does not carry keeping the rough approximation.
Each vertex of a path adds 64 bytes a ray to the hit lighting's radiance buffer; where the buffer no longer fits one storage binding of the device the hit lighting is refused with a line in the console naming the bounces and the refraction events (and again when they or the image change).

```js
world.reflections = {
  reflectionHardwareRayTracingHitLighting: true,
  reflectionMaxBounces: 3, // a mirror seen in a mirror, twice
}
```

`reflectionMaxRefractionBounces` (0, from 0 to 63) is the refraction events a path of the hit lighting goes through after the first. With 0 the translucent surfaces are passed by, as always; with 1 or more the hit lighting
meets them, lights them like any hit, weighed by their coverage, and the path goes on straight through the first surface it met — in the direction it began, from just past that surface — weighed by what the coverage
lets through, for up to that many more stretches while any channel of what is left stays at a hundredth or more; each stretch has its own reflections (up to `reflectionMaxBounces`), and a stretch whose first ray
leaves the scene reads the sky and ends the path. `reflectionRayTracedTranslucentRefractions` (on) is the project's switch: off, the refraction events do nothing. A path holds `reflectionMaxBounces × (1 + reflectionMaxRefractionBounces)`
vertices at most, 64 bytes each in the radiance buffer.

```js
world.reflections = {
  reflectionHardwareRayTracingHitLighting: true,
  reflectionMaxRefractionBounces: 2, // see through two layers of glass
}
```

## Traced translucency

Options of the reflections (`packages/sdk-core/src/contracts/tracedTranslucencyOptions.ts`), each with the reference's default.
`translucencyType: 'rayTraced'` (or `rayTracedTranslucency: 'on'`) draws the see-through surfaces with rays cast through the scene's
triangles, a primary path from the eye through up to `translucencyMaxPrimaryHitEvents` (4) surfaces and off each a secondary path of up to
`translucencyMaxSecondaryHitEvents` (2) more, ended when its throughput falls under `rayTracedTranslucencyPathThroughputThreshold` (0.001);
`translucencyRefraction` bends the rays through surfaces of an index of refraction above one (and keeps the rays one a pixel);
`rayTracedTranslucencyForceOpaque` (false) makes the rays treat every surface as opaque: by default a ray passes the holes of a masked
material (a surface with an `alphaTest`, cut where its opacity times its base map's alpha is under the threshold, at the finest level of the map),
set, the holes are filled and the rays skip the test; `rayTracedTranslucencySampleTranslucentReflectionInReflections` (true), `rayTracedTranslucencyDownsampleFactor` (1)
and `rayTracedTranslucencyMaxRayIntensity` (1000, in the display's white) complete it.

```js
const world = await createWorld({
  reflections: {
    translucencyType: 'rayTraced',
    translucencyRefraction: true,
    translucencyMaxPrimaryHitEvents: 6,
  },
})
world.reflections = { rayTracedTranslucencyMaxRayIntensity: 200 } // changed from the next frame
```

The traced translucency runs where the scene is traced through its triangles and the image has a transparent front layer: one ray a pixel the layer covers (a block of
`rayTracedTranslucencyDownsampleFactor` pixels a side casting one) is cast from the eye to just short of the opaque depth, the radiance, the throughput and the
background it lets show are resolved and accumulated over the images (the reflections' history length and clamp), and the lit image is multiplied by the throughput and
the radiance laid over it. The raster draws of the transparents are then left out (particles are still drawn); until the kernels are compiled, or where the image
has no front layer, the raster draws them as before. A hit's material is the constants of the surface its placement wears; its light is the surface cache's where the
placement has cards, plus the sky light's irradiance on the diffuse colour of a translucent surface.

```js
const g = material.graph('surface')
g.output('baseColor', g.constant(0.05, 0.08, 0.1))
g.output('opacity', g.constant(0)) // pure water; 1 shows the base material alone (foam)
g.output('scatteringCoefficients', g.constant(0.0003, 0.0004, 0.0006)) // per centimetre
g.output('absorptionCoefficients', g.constant(0.0004, 0.00015, 0.0001))
g.output('phaseG', g.constant(0.2))
g.output('colorScaleBehindWater', g.constant(1, 1, 1))
g.output('roughness', g.constant(0.05))
const water = material.meshStandard({ graph: g }) // wired to a water output: drawn as the water
```

The settings are the reference's `r.Water.SingleLayer.*`, each an option of `createWorld` too, held over the quality preset
(which writes none of them), changed later from the next frame
(`packages/sdk-core/src/contracts/singleLayerWaterOptions.ts`); a value a setting does not take is refused. Distances are
metres, where the reference's are centimetres:

| Field                                                 | Meaning                                                                                                                                                                                                                                                      | Default          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `singleLayerWater`                                    | Whether the water is drawn                                                                                                                                                                                                                                   | `true`           |
| `singleLayerWaterReflection`                          | The reflection: `'enabled'` (the front layer's trace), `'disabled'`, `'captures'` (the captures and the sky) or `'screenSpace'` (the screen march and the captures, no scene ray)                                                                            | `'enabled'`      |
| `singleLayerWaterReflectionDownsample`                | Times fewer pixels a side (1 or 2) the water's reflections are traced at                                                                                                                                                                                     | `1`              |
| `singleLayerWaterReflectionCheckerboard`              | With a downsample of 2, blocks of two pixels across and one down                                                                                                                                                                                             | `false`          |
| `singleLayerWaterReflectionReconstruction`            | A pixel rebuilds its reflection from the rays round it                                                                                                                                                                                                       | `false`          |
| `singleLayerWaterReflectionDenoising`                 | The temporal and the bilateral denoising of the water's reflections                                                                                                                                                                                          | `false`          |
| `singleLayerWaterReflectionTemporal`                  | The temporal denoising of the `'screenSpace'` technique                                                                                                                                                                                                      | `true`           |
| `singleLayerWaterUnderwaterFogWhenCameraIsAboveWater` | The height fog is also laid on the scene seen through the water, at the depth of what lies behind it, with the camera above the water                                                                                                                        | `false`          |
| `singleLayerWaterTiledComposite`                      | The reflection composite draws the 8 by 8 tiles that hold water, not the whole target                                                                                                                                                                        | `true`           |
| `singleLayerWaterTiledSceneColorCopy`                 | The scene's colour is copied for those tiles alone (with the refraction culling on and the copy not downsampled)                                                                                                                                             | `true`           |
| `singleLayerWaterWaveOps`                             | The tiles are listed with subgroup operations where the device grants them                                                                                                                                                                                   | `true`           |
| `singleLayerWaterDepthPrepass`                        | The water's depth is drawn first (the tiles and the refraction mask need it)                                                                                                                                                                                 | `true`           |
| `singleLayerWaterOptimizedClear`                      | The scene's depth is copied over the view alone, not the whole texture                                                                                                                                                                                       | `true`           |
| `singleLayerWaterVelocityOutputPass`                  | When the water writes its velocity: `'depthPrepass'` (right after its depth), `'basePass'` (with its shading) or `'none'`                                                                                                                                    | `'depthPrepass'` |
| `singleLayerWaterShadersSupportDistanceFieldShadow`   | The programs keep the sun apart from the rest of the water's light, for the sun's distance-field shadow; read when the session opens                                                                                                                         | `true`           |
| `singleLayerWaterDistanceFieldShadow`                 | The sun's light on the water is kept apart and shadowed by the sun's classic distance-field cascade (`shadowVirtualEnable` off): traced on the water's depth, upsampled over the tiles that hold water, then multiplied into the separated sun before the composite (needs the setting above and meshes with fields)                            | `true`           |
| `singleLayerWaterShadersSupportVsmFiltering`          | The programs hold the full trace of the sun's shadow for the water; read when the session opens                                                                                                                                                              | `false`          |
| `singleLayerWaterVsmFiltering`                        | The sun's shadow on the water is the full projection the opaque surfaces get, not one sample: the shading reads the sun unshadowed (`shadowSkipSun`), the shadow maps are projected onto the water's surface over the tiles that hold water, and the separated sun is multiplied by that share before the composite (needs the setting above and `singleLayerWaterDepthPrepass`, which lists the tiles) | `false`          |
| `singleLayerWaterCloudShadow`                         | The clouds shade the sun that lights the water's volume                                                                                                                                                                                                      | `false`          |
| `singleLayerWaterRefractionDownsample`                | Times fewer pixels a side (1 or 2) the copy of the scene the water refracts is made at                                                                                                                                                                       | `1`              |
| `singleLayerWaterRefractionCulling`                   | Skip the refraction where it shows little (the three cullings below)                                                                                                                                                                                         | `false`          |
| `singleLayerWaterRefractionDistanceCulling`           | Metres from the camera past which the refraction is skipped; 0 none                                                                                                                                                                                          | `0`              |
| `singleLayerWaterRefractionDistanceCullingFadeRange`  | Metres over which it fades out before that distance                                                                                                                                                                                                          | `4`              |
| `singleLayerWaterRefractionFresnelCulling`            | Fresnel reflectance above which the refraction is skipped; 0 none                                                                                                                                                                                            | `0`              |
| `singleLayerWaterRefractionFresnelCullingFadeRange`   | The Fresnel range over which it fades out                                                                                                                                                                                                                    | `0.2`            |
| `singleLayerWaterRefractionDepthCulling`              | Metres of water depth below which the refraction is skipped; 0 none                                                                                                                                                                                          | `0`              |
| `singleLayerWaterRefractionDepthCullingFadeRange`     | Metres of depth over which it fades out                                                                                                                                                                                                                      | `1`              |

The water writes its velocity as the reference's water pass does: the vectors of the texels it covers become the camera's motion at
the water's depth and their visibility identifiers are cleared, so that the temporal pass and the motion blur read a surface that
moves with the camera alone. Not ported: `ForceVelocity` (deprecated, ignored by the reference itself), `MobileFallback` and
`r.ParallelSingleLayerWaterPass` (a mobile renderer and a render-thread parallelism this engine does not have). `screenSpace` is the
screen march alone — full resolution, no scene ray, no far screen trace, no reconstruction or spatial filter —, `captures` the
captures and the sky, `disabled` no reflection.

```js
const world = createWorld('viewer', { singleLayerWaterRefractionDownsample: 2 }) // a coarser copy of the scene
world.singleLayerWater = { singleLayerWaterReflection: 'captures' } // no ray: the captures and the sky, from the next frame
world.singleLayerWater = {
  singleLayerWaterRefractionCulling: true,
  singleLayerWaterRefractionDistanceCulling: 200,
}
world.singleLayerWater = { singleLayerWaterReflection: null } // given back its default
```

The explorer takes the same by field (`explorer.setSingleLayerWater('singleLayerWaterReflection', 'captures')`), and an agent
through `trillion3d_set_single_layer_water`.
