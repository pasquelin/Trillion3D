# Single-layer water

A lit surface whose graph wires any of four water outputs (`scatteringCoefficients`,
`absorptionCoefficients`, `phaseG`, `colorScaleBehindWater`; first two per centimetre) is water seen
through one layer. Drawn over the opaque scene, after lights, before translucent layers, in
reference single-layer water passes:

1. scene without water copied (depth as view distance, colour);
2. water depth drawn first;
3. water shaded over the copy: surface lit by declared lights as a physical surface, base colour
   under `opacity` coverage (1 base material only, 0 pure water), volume to the scene behind
   integrated analytically;
4. surface reflection added.

Volume = sun in-scattering (`phaseG` phase function along the refracted view; sun = forward
directional light) plus ambient, over the share scattered before absorption, less surface Fresnel
reflectance. The scene behind is read where the surface refracts it (index of refraction from
`specular` or the `refraction` output), dimmed by colour absorption over water depth and by the fall
from scene to water height, times `colorScaleBehindWater`. Reflection = transparents' front-layer
trace weighed on surface reflectance, faded in over the first 50 cm of water above the scene, traced
whatever `reflectionFrontLayer` says. Water depth becomes the scene's: fog, particles and later
transparents hide behind it.

## Reflection hit lighting

Options (`packages/sdk-core/src/contracts/hitLightingOptions.ts`), reference defaults. A reflection
ray hitting scene triangles reads surface cache light at the hit. With
`reflectionHardwareRayTracingHitLighting: true`, hits the cache cannot light are collected, sorted
by material (`reflectionHardwareRayTracingBucketMaterials`, on) and lit in place:

- hit material under scene lights (`hardwareRayTracingHitLightingDirectLighting` on): diffuse +
  specular lobe toward the eye, times a shadow ray each (`hardwareRayTracingHitLightingShadowMode`
  `'off'`, `'hard'` or `'soft'`);
- plus emitted and indirect light: surface cache's, or sky light irradiance with
  `hardwareRayTracingHitLightingSkylight: 'on'`, where
  `hardwareRayTracingHitLightingReflectionCaptures: true` adds specular from the sky light's
  filtered cube along the reflected ray;
- direct lighting off, no sky light: surface cache light as is; off with sky light: sky light terms
  only.

`hardwareRayTracingLightingMode: 'hitLighting'` (or `'hitLightingForReflections'`) lights every
reflection hit so; `'hitLighting'` alone also lights hits of screen-probe rays
(`screenProbeHardwareRayTracing`) and radiance-cache rays (other modes keep surface cache light).
`hardwareRayTracingHitLightingAllowed` (on) forbids it all;
`hardwareRayTracingHitLightingForceOpaque` (off) skips masks' any-hit test;
`hardwareRayTracingHitLightingShadowTranslucencyMode` sets what shadow rays cut: `'opaque'` every
surface, `'masked'` (default) masked by alpha, no translucent, `'fractional'` masked, and through
translucent the share their coverage passes.

```js
const world = await createWorld({
  reflections: {
    reflectionHardwareRayTracingHitLighting: true,
    hardwareRayTracingHitLightingShadowMode: 'hard',
  },
})
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // every hit lit where it stands, from the next frame
```

Hits find lights through a grid. The box holding local lights' reach (points, spots,
rectangles) is cut into `rayTracingLightGridResolution` (256, 1 to 2048) cells a side per axis; a
cell keeps lights whose reach overlaps it (spot by cone, facing away not at all) up to
`rayTracingLightGridMaxCount` (128, 1 to 65536; at most the local light count); a hit loops over the
suns and its cell's lights. `rayTracingLightGridAxis` (-1) picks per cell the axis keeping fewest
lights; 0, 1, 2 forces it. A cell overlapped by more lights than it keeps is marked overflowing and
a hit there loops over every light (reference loses the rest; declared fix); raise
`rayTracingLightGridMaxCount` for dense overlap. Rebuilt only when lights change; past device or
memory budget, every light is looped. No culling by rectangle barn doors.

```js
world.reflections = { rayTracingLightGridResolution: 128, rayTracingLightGridMaxCount: 256 } // a coarser grid keeping more lights a cell
```

With `hardwareRayTracingLightingMode: 'hitLighting'` screen-probe rays
(`screenProbeHardwareRayTracing`, scene triangles traced) light hits the same way: triangle hits
marked with a material key, sorted by material (`reflectionHardwareRayTracingBucketMaterials`), lit
where they stand (material, lights, shadow rays; sun shadow ray to `screenProbeMaxTraceDistance`)
plus surface cache indirect light (or sky light's with `hardwareRayTracingHitLightingSkylight:
'on'`), sky light leaking onto the hit, and height fog over the ray. Probe rays: one bounce, no
refraction, no reflection capture, whatever `reflectionMaxBounces` says; a back-face hit on a not
two-sided surface ends the ray unlit. Buffers hold 80 bytes per view ray (8 hit-list entry, 8 sorted
copy, 64 path radiance). If radiance exceeds one storage binding the mode is refused with a console
line; with no memory budget left, probes keep surface cache light for the image, mode unchanged.

```js
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // reflections and screen probes alike
```

Radiance-cache rays light hits the same way (`screenProbeRadianceCacheHardwareRayTracing`, scene
triangles traced; same `'hitLighting'` mode, other two keep surface cache light): marks of a slice
of the cache's tile list are collected, sorted by material
(`reflectionHardwareRayTracingBucketMaterials`) and lit where they stand (material, lights, shadow
rays; sun shadow ray to `screenProbeMaxTraceDistance`; surface cache indirect light or sky light's);
sky light leaking onto the hit is added where the cache makes irradiance maps; the sum is written to
the trace atlas under the cache pre-exposure. No face culled; a back-face hit on a not two-sided
surface ends the ray unlit. Cache rays: one bounce, no refraction, no reflection capture, whatever
`reflectionMaxBounces` says. A slice = as many tiles as fit ray radiance (64 bytes a ray) in a
storage binding; a large update takes more slices. Held maps are retraced on toggle.

```js
world.reflections = { hardwareRayTracingLightingMode: 'hitLighting' } // the screen probes' rays and the radiance cache's, lit where they hit
world.indirectLight = { screenProbeRadianceCacheHardwareRayTracing: true } // the cache casts through the scene's triangles (its default)
```

`reflectionMaxBounces` (1, 1 to 64): most reflection rays in a hit-lighting path. 1: the ray stops
at the first lit hit; more: the path continues from each lit hit along the reflection of its own
specular lobe (visible normal drawn by frame noise), weighed by top-layer reflectance (environment
BRDF of specular colour). Each hit is lit as the first; a ray leaving the scene reads the sky. The
path ends where accumulated roughness passes what reflections trace (`reflectionMaxRoughnessToTrace`,
fade). Each path vertex adds 64 bytes a ray to the radiance buffer; past one storage binding
the hit lighting is refused with a console line naming bounces and refraction events.

```js
world.reflections = {
  reflectionHardwareRayTracingHitLighting: true,
  reflectionMaxBounces: 3, // a mirror seen in a mirror, twice
}
```

`reflectionMaxRefractionBounces` (0, 0 to 63): refraction events of a hit-lighting path after the
first. 0: translucent surfaces are passed by. 1 or more: hit lighting meets and lights them like any
hit, weighed by coverage; the path goes straight through the first surface met (starting direction,
from just past it), weighed by the coverage's pass-through, for up to that many more stretches while
any remaining channel stays at 1/100 or more. Each stretch has its own reflections (up to
`reflectionMaxBounces`); a stretch whose first ray leaves the scene reads the sky and ends the path.
`reflectionRayTracedTranslucentRefractions` (on): off, refraction events do nothing. A path holds at
most `reflectionMaxBounces × (1 + reflectionMaxRefractionBounces)` vertices, 64 bytes each in the
radiance buffer.

```js
world.reflections = {
  reflectionHardwareRayTracingHitLighting: true,
  reflectionMaxRefractionBounces: 2, // see through two layers of glass
}
```

## Traced translucency

Options (`packages/sdk-core/src/contracts/tracedTranslucencyOptions.ts`), reference defaults.
`translucencyType: 'rayTraced'` (or `rayTracedTranslucency: 'on'`) draws see-through surfaces with
rays through scene triangles: a primary path from the eye through up to
`translucencyMaxPrimaryHitEvents` (4) surfaces, off each a secondary path of up to
`translucencyMaxSecondaryHitEvents` (2) more, ended when throughput falls under
`rayTracedTranslucencyPathThroughputThreshold` (0.001). Further options:

- `translucencyRefraction` bends rays through surfaces of index of refraction above 1 (rays one a
  pixel);
- `rayTracedTranslucencyForceOpaque` (false): rays pass holes of a masked material (`alphaTest`
  surface, cut where opacity times base-map alpha is under threshold); set, holes are filled;
- `rayTracedTranslucencySampleTranslucentReflectionInReflections` (true),
  `rayTracedTranslucencyDownsampleFactor` (1), `rayTracedTranslucencyMaxRayIntensity` (1000, display
  white units).

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

Runs where the scene is traced through triangles and the image has a transparent front layer. One
ray per layer-covered pixel (one per `rayTracedTranslucencyDownsampleFactor` block a side) goes from
the eye to just short of opaque depth; radiance, throughput and background are accumulated over
images (reflections' history length and clamp); the lit image is multiplied by throughput with
radiance laid over. Raster draws of transparents are left out (particles still drawn); until kernels
compile, or with no front layer, raster draws them. A hit's material = constants of its placement's
surface; its light = surface cache's where the placement has cards, plus sky light irradiance on a
translucent surface's diffuse colour.

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

Settings are reference `r.Water.SingleLayer.*`, each also a `createWorld` option, held over the
quality preset, changeable from the next frame
(`packages/sdk-core/src/contracts/singleLayerWaterOptions.ts`); an unaccepted value is refused.
Distances in metres (reference: centimetres):

| Field | Meaning | Default |
| - | - | - |
| `singleLayerWater` | Water drawn | `true` |
| `singleLayerWaterReflection` | `'enabled'` (front-layer trace), `'disabled'`, `'captures'` (captures + sky), `'screenSpace'` (screen march + captures, no scene ray) | `'enabled'` |
| `singleLayerWaterReflectionDownsample` | Reflection trace downsample per side (1 or 2) | `1` |
| `singleLayerWaterReflectionCheckerboard` | With downsample 2, 2x1-pixel blocks | `false` |
| `singleLayerWaterReflectionReconstruction` | Pixel rebuilds reflection from neighbouring rays | `false` |
| `singleLayerWaterReflectionDenoising` | Temporal + bilateral reflection denoising | `false` |
| `singleLayerWaterReflectionTemporal` | Temporal denoising of `'screenSpace'` | `true` |
| `singleLayerWaterUnderwaterFogWhenCameraIsAboveWater` | Height fog also on the scene seen through water, camera above water | `false` |
| `singleLayerWaterUnderwaterTest` | Camera tested against water bodies each image (possibly in the water: clouds also composed into the scene seen through water; under water: sky, fog and clouds composed before the water) | `true` |
| `singleLayerWaterUnderwaterTraceDistance` | Metres of the sphere swept up from the camera to find nearby bodies | `1` |
| `singleLayerWaterUnderwaterPreciseTraceDistance` | Metres of the sphere at the camera verifying overlap once under a body's surface | `0.1` |
| `singleLayerWaterTiledComposite` | Reflection composite draws only the 8x8 tiles holding water | `true` |
| `singleLayerWaterTiledSceneColorCopy` | Scene colour copied for those tiles only (refraction culling on, copy not downsampled) | `true` |
| `singleLayerWaterWaveOps` | Tiles listed with subgroup ops where granted | `true` |
| `singleLayerWaterDepthPrepass` | Water depth drawn first (tiles, refraction mask need it) | `true` |
| `singleLayerWaterOptimizedClear` | Scene depth copied over the view only | `true` |
| `singleLayerWaterVelocityOutputPass` | Velocity written: `'depthPrepass'` (after depth), `'basePass'` (with shading), `'none'` | `'depthPrepass'` |
| `singleLayerWaterShadersSupportDistanceFieldShadow` | Programs keep sun apart; read at session open | `true` |
| `singleLayerWaterDistanceFieldShadow` | Sun kept apart, shadowed by the classic distance-field cascade (`shadowVirtualEnable` off): traced on water depth, upsampled over water tiles, multiplied into the sun before composite (needs setting above) | `true` |
| `singleLayerWaterShadersSupportVsmFiltering` | Programs hold the full sun-shadow trace; read at session open | `false` |
| `singleLayerWaterVsmFiltering` | Sun shadow = full projection opaque surfaces get: shading reads sun unshadowed (`shadowSkipSun`), shadow maps projected onto water over water tiles, separated sun multiplied by that share before composite (needs setting above, `singleLayerWaterDepthPrepass`) | `false` |
| `singleLayerWaterCloudShadow` | Clouds shade the sun lighting the volume | `false` |
| `singleLayerWaterRefractionDownsample` | Refracted scene copy downsample per side (1 or 2) | `1` |
| `singleLayerWaterRefractionCulling` | Skip refraction where it shows little (three cullings below) | `false` |
| `singleLayerWaterRefractionDistanceCulling` | Skip refraction past this distance (m); 0 none | `0` |
| `singleLayerWaterRefractionDistanceCullingFadeRange` | Fade-out range before it (m) | `4` |
| `singleLayerWaterRefractionFresnelCulling` | Skip refraction above this Fresnel reflectance; 0 none | `0` |
| `singleLayerWaterRefractionFresnelCullingFadeRange` | Fade-out Fresnel range | `0.2` |
| `singleLayerWaterRefractionDepthCulling` | Skip refraction below this water depth (m); 0 none | `0` |
| `singleLayerWaterRefractionDepthCullingFadeRange` | Fade-out depth range (m) | `1` |

Each image the camera is tested against the water bodies: a mesh with a single-layer water material
is a body, a volume under its box's footprint, from its bottom (`depth` metres under the surface at
rest, or the box's bottom when deeper) to its surface at rest plus the crest of its `mesh.waves`.
Only bodies with an underwater material (`mesh.waterBody.underwaterPostProcess`, true by default)
count; bodies with waves first, then higher `mesh.waterBody.overlapPriority` (0 by default). A
camera under the surface at its point (waves included), or within 10 cm across and a crest (10 cm at
least) of the nearest surface, is under water; one within the crest and the near plane's corner
distance of the surface at rest may intersect it. A camera that may intersect has clouds also
composed into the scene copy seen through the water (`VolumetricComposeOverScene`); a camera under
water has sky, fog, clouds and translucent layers composed before the water, and no fog on the copy
behind it. No body: nothing changes.

```js
mesh.waterBody = { underwaterPostProcess: true, overlapPriority: 1, depth: 30 } // a lake 30 m deep
```

An exclusion volume (`object.waterExclusion()`; reference water body exclusion volume) takes bodies
out of this test where the camera stands in it: a unit cube centred on the node, scaled and turned
with it; an excluded body is skipped (no underwater material, no clouds, fog or sky before it).
`mode` is `'allExceptListed'` by default (every body the volume overlaps but those in `bodies`;
every one when `bodies` is empty) or `'onlyListed'` (the listed bodies the volume overlaps);
`bodies` holds the meshes carrying the bodies. A volume is a node: it moves, nests, is copied
(`object.clone`) and saved (`scene.toJSON`: bodies by rank in the saved tree, a node a model's file carries by the model and its name, a node outside the tree kept in its place as a node in no scene; a mesh's `waterBody` is saved and copied too). No volume: nothing
changes. The surface is cut too: inside a volume that excludes its body, neither the water's
colour nor its depth is drawn, in the water pass and in the transparents' front pass (a program variant, compiled only for a world that holds a volume; the
volumes sit in a small table written when one moves or changes, and the programs are built again, off the frame, when the first volume appears or the last goes). Not carried: the collision, the
physics holding one global water plane with nothing per body to cut.

```js
const hold = object.waterExclusion() // a dry hold in the lake: every body it overlaps is excluded
hold.scale.set(4, 3, 8)
hold.position.set(0, 9, 0)
scene.add(hold)
const only = object.waterExclusion('onlyListed', [lakeMesh]) // excludes the lake alone
```

Water writes velocity as the reference: covered texels get camera motion at water depth and their
visibility identifiers are cleared. Not ported: `ForceVelocity`, `MobileFallback`,
`r.ParallelSingleLayerWaterPass`. `screenSpace` = screen march alone (full resolution, no scene ray,
no far screen trace, no reconstruction or spatial filter), `captures` = captures + sky, `disabled` =
no reflection.

```js
const world = createWorld('viewer', { singleLayerWaterRefractionDownsample: 2 }) // a coarser copy of the scene
world.singleLayerWater = { singleLayerWaterReflection: 'captures' } // no ray: the captures and the sky, from the next frame
world.singleLayerWater = {
  singleLayerWaterRefractionCulling: true,
  singleLayerWaterRefractionDistanceCulling: 200,
}
world.singleLayerWater = { singleLayerWaterReflection: null } // given back its default
world.singleLayerWater = { singleLayerWaterUnderwaterTraceDistance: 3 } // finds the water bodies up to 3 m from the camera
world.singleLayerWater = { singleLayerWaterUnderwaterTest: false } // the camera is never in the water
```

Explorer takes the same by field (`explorer.setSingleLayerWater('singleLayerWaterReflection',
'captures')`); agent: `trillion3d_set_single_layer_water`.