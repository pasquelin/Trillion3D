# Surface cache: debug views
The surface cache draws its own tables and boxes over the image, as a diagnostic mode or as a setting (`world.surfaceCache`); a mode shows its view whatever the setting says, and keeps the cache up while it is shown. Nothing is drawn, and nothing is copied from the GPU, while none is asked.

| Mode | Setting | Default | What it shows |
| --- | --- | --- | --- |
| `surface-cache-direct-stats` | `surfaceCacheLightingStats: 1` | `0` | the table of the direct light update, from a tenth of the image's width and height: the tiles of each of the 16 priority buckets (eight a line), `MaxBucket` and `MaxTilesFromMaxBucket` (the bucket the budget ends in and the tiles of it that fit), then the pages and the tiles the image lights; read back from the GPU a few images late |
| `surface-cache-indirect-stats` | `surfaceCacheLightingStats: 2` | `0` | the same table for the indirect light (radiosity) update |
| `surface-cache-direct-lighting-stats` | `surfaceCacheLightingStats: 3` | `0` | the lights the direct update gathers (`#Lights`, `Batched Lights`, `Standalone Lights`, whether rectangles, light functions and IES lights are among them), the atlas (`AtlasResolution`, `UpdateAtlasSize`, `MaxUpdateTiles`, `UpdateFactor`), the trace (`Method`, `RT Traces`: the groups of 64 shadow traces, an overestimate) and the cards and tiles being updated; read back a few images late |
| `surface-cache-scene-stats` | `surfaceCacheSceneStats` | `false` | `NumPrimitiveGroups`, `NumMeshCards` and `NumCards`: the placements that have cards, their mesh cards and the cards in the scene |
| `surface-cache-primitive-groups` | `surfaceCacheVisualizePrimitiveGroups` | `false` | the box of every placement that has mesh cards, in white, in the world (the first thirteen hundred: a view's line list holds 16384 segments) |
| none | `surfaceCacheViewCards` | `false` | the box of every card the direct light update lights in this image, in green, in the world |
| none | `surfaceCacheViewTiles` | `false` | the box of every tile of 8 by 8 texels the direct light update lights in this image, in yellow, in the world |
| none | `surfaceCacheCursorCard` | `false` | the card under the cursor (`debugCursorX`, `debugCursorY` of the screen probes' settings), found by a ray through the scene: its box in red, the tile under the cursor in purple, and at the bottom left of the image a preview of its layer `surfaceCacheCursorCardLayer` (`3`, from 0 to 4: the albedo, the normal, the emission, the direct light, the indirect light) in a yellow frame |
| none | `surfaceCacheRadiosityVisualizeProbes` | `false` | a sphere at each radiosity probe of the cards (one every `surfaceCacheRadiosityProbeSpacing` texels), over the image and behind the surfaces, of radius `surfaceCacheRadiosityVisualizeProbeRadius` (`10` centimetres), coloured by the light the probe's harmonics give along the sphere's normal; with `surfaceCacheRadiosityVisualizeProbesShowInvalid` (`false`) the probes that lie on no surface are drawn too, in pink. It needs `surfaceCacheRadiosity` |

The screen probes and the world's probes have tables of their own, drawn the same way (the numbers come back from the GPU a few images late, and nothing is copied while none is asked):

| Mode | Setting | Default | What it shows |
| --- | --- | --- | --- |
| `radiance-cache-stats` | `screenProbeRadianceCacheStats` | `false` | the update of the world's probes: `MaxProbesInAtlas` and `ProbesInAtlas` (the probes the atlas holds out of the most it can), `Unfilled` (holding nothing yet), `Refreshing` (not traced since the lights last changed), `Refused` (marks refused for want of a probe), `Traced Probes` (queued by the last pass) and `Marked` (cells marked) |
| `screen-probe-gather-debug` | `screenProbeGatherDebug` | `false` | at four fifths of the image's width: `NumScreenProbes`, `NumUniformScreenProbes` and `NumAdaptiveScreenProbes` |
| `screen-probe-tile-stats` | `screenProbeTileDebugMode` | `false` | the integration's tiles: the tile grid, then the tiles of the `Simple`, `ImportanceSample` and `All` modes and their total, with the legend in green, orange and cyan, and each tile of the three modes filled half transparent in its colour over the pixels it covers (needs `screenProbeIntegrationTileClassification`) |
| `screen-probe-placement` | `screenProbeGatherDebugProbePlacement` | `0` | where the screen probes stand: `1` a 2-pixel quad at the pixel of every probe (yellow uniform, magenta adaptive), `2` the adaptive probes alone, `3` a cross of 2 cm and a 10 cm line along the normal at each probe's point; drawn by the GPU through one buffer of up to 262144 appended lines, nothing allocated while none is asked (the mode shows `1`) |
| `screen-probe-traces` | `screenProbeGatherVisualizeTraces` | `false` | the rays of the screen probe nearest to the cursor (to the middle of the image where none is set): a line from the probe along each ray, as long as the distance it reached, coloured by the radiance it brought back seen through the table the image is composed with (the colour grade and the display curve at the image's exposure); a ray that ended within 1 cm of its probe is drawn red and 5 cm long. `screenProbeGatherVisualizeTracesFreeze` (`false`) keeps the rays as they were at the last image that updated them so the camera can move round them; `visualizeUseShaderPrintForTraces` (`true`) set to `false` draws the lines against the opaque depth, a ray behind a surface hidden by it, and always through the composition's table; `visualizeToneMap` (`true`) set to `false` colours the lines drawn over everything by the display's transfer alone; `debugCursorX` and `debugCursorY` (`-1`, none) set the cursor in display pixels |
| `reflection-traces` | `reflectionVisualizeTraces` | `false` | the reflection ray of the pixel under the cursor (`debugCursorX`, `debugCursorY`; nothing where none is set): a line from the surface along the ray, as long as the distance it reached, in the radiance it brought back as it is, a yellow cross of 2 cm at its end, and the grid texel, the distance and the radiance as text, read back from the GPU a few images late; needs the reflections to have traced an image |
| `radiance-cache-probes` | `radianceCacheVisualize` | `0` | a sphere at every probe of the world's probes, hidden by the surfaces in front of it: coloured by the irradiance it holds along its surface at an albedo of 0.3 (a probe inside a surface red, one moved off the surfaces tinted green, an adaptive one cyan) where the irradiance field is the indirect light, by its radiance otherwise; `radianceCacheVisualize: 2` colours it by the share of its rays that left the scene; `radianceCacheVisualizeRadiusScale` (`1`) scales the spheres (5% of the cell at one); `radianceCacheVisualizeClipmapIndex` (`-1`, all) draws one level, the finest 0 |
| `scene-visualization` | none (the mode only) | - | the scene traced from the camera pixel by pixel through the global distance field (or, with `visualizeHardwareRayTracing`, the scene's triangles), lit by what the surface cache holds at the hit and by the sky where the ray leaves the scene, replacing the image; `visualizeSceneTraceRadianceCache` (`false`) ends the trace where the world's probes cover the eye and reads their light past it (their spheres' light, interpolated between the eight probes round the eye), and marks the probes round the eye so that they exist; `visualizeHiResSurface` (`true`) reads the finest page of the cache; `visualizeMinTraceDistance` (`0`, read as `0.01` at least) and `visualizeMaxTraceDistance` (`100000`) bound the trace in centimetres; `visualizeToneMap` (`true`) picks the colour curve. `visualizeMode` (`0`) shows the scene view by itself with the number of one of its modes (3 the scene, which the diagnostic mode shows; 1 the overview of the geometry normals, the reflection view and the coverage in three labelled tiles; 4 the reflection view, traced as far as the reflections trace; 5 the coverage, pink where a mesh has cards but none covers the point and yellow where it has none; 6 the geometry normals; 8 the albedo; 9 the normals; 10 the emission; 11 the card weights; 12 the direct light; 13 the indirect light; 16 and 17 the images since each page's direct and indirect light were updated; 18 and 19 the last use of the pages; 20 the number of lights each tile tracks the shadow factor of; 21 the sharing of the cards; 24 the radiosity images accumulated); under an orthographic camera every ray runs along the view's direction from its own pixel, and the height fog (`reflectionHeightFog`, `reflectionMinDistanceForFoggingSky`) is laid over the light. `visualizeSurfaceCacheFeedback` (`false`) lets the view write the cache's feedback so that the modes 18 and 19 show the last use of the pages; `visualizeHardwareRayTracing` (`true`) traces the view's rays through the scene's triangles where the scene has them (the tiles of 8 by 8 pixels are listed, a ray is listed for each pixel, traced, and lit by the cards of the placement it meets; the sky light for a ray that meets nothing) in place of the march through the distance field, and `visualizeCullingMode` (`0`; `1` the back faces, `2` the front faces) names the faces those rays pass; mode 7 marks the pixels that trace dedicated reflection rays (red, green for foliage, the darker the rougher) over the albedo lit from one side. Example: `{ "visualizeMode": 3, "visualizeHardwareRayTracing": true, "visualizeCullingMode": 1 }` |
| `material-properties` | none (the mode only) | - | the material of the pixel under the cursor (`debugCursorX`, `debugCursorY`; the middle of the image where none is set) as a table of text, read back from the GPU a few images late: the pixel, the `Closure Count` and `Material Mode` (None, Unlit, Physical, Diffuse, Toon, Shadow catcher or Debug view, with the pixel's shading model — Subsurface, Preintegrated skin, Subsurface profile, Hair, Eye — and ` - Legacy Clear Coat` or ` - Legacy Cloth` where the surface wears one), the `AO` (the occlusion the surface carries) and `TopRoughness` (the clear coat's where there is one), then the closure: its type (`Slab`, `Hair`, `Eye`, `Unlit`), `BasisType` (`Normal`, or `Nor+Tan` where the surface is anisotropic) and normal, `Diffuse` (the base colour times one minus the metalness), `F0` (the specular colour at normal incidence) and the `Specular`, `Roughness`, `Anisotropy` and its direction, the `Clear coat` (weight, roughness, normal), the `Fuzz` of a cloth (colour, weight) and the `Emissive` colour; a field the surface does not carry is not printed; needs the lit surfaces |

The scene table also writes `AddOps` and `RemoveOps`: the count of the placements that wanted mesh cards or lost them in the image, then the ids of the first seven.

```js
// The world's probes update table, and the count of the screen probes.
const world = createWorld('viewer', {
  screenProbes: 'high',
  screenProbeRadianceCacheStats: true,
  screenProbeGatherDebug: true,
})
world.diagnostic.mode = 'screen-probe-tile-stats' // or by mode: the integration's tiles
```

## Reflections that read the radiance cache

`reflectionRadianceCache` (`false`) makes the rough reflections read the screen probes' radiance cache (`screenProbeRadianceCache`, on by default) instead of tracing their whole ray. A pixel whose roughness, plus a blue noise `reflectionRadianceCacheRoughnessFadeLength` wide (`0.05`), passes `reflectionRadianceCacheMinRoughness` (`0.2`), and whose point the cache covers with all eight probes round it, casts a ray shortened from `reflectionRadianceCacheMaxTraceDistance` (`5000` cm) at that roughness to `reflectionRadianceCacheMinTraceDistance` (`1000` cm) at `reflectionRadianceCacheMaxRoughness` (`0.35`), never under the distance the cache asks to be traced before it is read, never over the view's longest ray. A shortened ray that meets nothing within its distance takes the light the cache holds along it from its point, through the cone of its angle, with the sky light's leaking, the height fog and the ceiling of a ray; the far screen trace of the opaque rays is off while the cache is read. `reflectionRadianceCacheStochasticInterpolation` (`true`) reads one probe of the eight, drawn by the interpolation weights at one half, `false` the eight weighed; `reflectionRadianceCacheReprojectionRadiusScale` (`10`, from 1 to 100000) scales the sphere round each probe the direction is corrected through. Run-time settings, read again at each image; nothing is traced differently where the cache is not made (the setting off, the probes cast none, the program still compiling).

```js
const world = createWorld('viewer')
world.reflections = { reflectionRadianceCache: true } // rough reflections read the cache past a short ray
world.reflections = { reflectionRadianceCacheMaxTraceDistance: 2000, reflectionRadianceCacheMinTraceDistance: 500 } // shorter rays, centimetres
world.reflections = { reflectionRadianceCacheStochasticInterpolation: false } // the eight probes, weighed
world.reflections = { reflectionRadianceCache: null } // back to the default, off
```

## Translucent surfaces that reflect the scene

A blended, water or transmissive surface that is not the traced front layer (`reflectionFrontLayer`, off by default) reflects, along its mirror direction, in this order. `reflectionTranslucencyRadianceCache` (`true`) reads the screen probes' radiance cache where it covers the fragment's point with all eight probes round it: through a cone of no width, one probe of the eight drawn at one half, the cache's level chosen by a fixed half, the mean of the noise a pixel would draw; where it covers nothing (or the setting is `false`, or the cache is not made) the surface reflects the environment through its lobe. Then `reflectionTranslucencyScreenQuality` (`3`, from 0 to 4; 0 turns it off, any other value, 1 to 4, runs the same fixed 12-step march, as the reference does) looks at the last lit image: when the view was not cut since it, a march of the depth pyramid of 12 steps from no offset, rougher surfaces looking at coarser levels; a hit, faded at the border of both images and by `saturate(2 - 6.6 * roughness)`, replaces the answer above by the share of its alpha, and the whole is weighed by the surface's reflectance as the front layer's is. A device that grants fewer than 23 sampled textures a stage, or a session whose `lightingDataFormat` is not `r11g11b10`, keeps the previous behaviour: the traced front layer where there is one, else the environment through the lobe. Run-time settings, read again at each image.

```js
const world = createWorld('viewer')
world.reflections = { reflectionTranslucencyRadianceCache: false } // glass and water reflect the environment, then the last image
world.reflections = { reflectionTranslucencyScreenQuality: 0 } // the cache or the environment alone, no march of the last image
world.reflections = { reflectionTranslucencyScreenQuality: null } // back to the default, 3
```

## Short-range occlusion through the scene's triangles

`screenProbeShortRangeAOHardwareRayTracing` (`false`) casts the screen probes' short-range occlusion, and its bent normal, through the scene's triangles in place of the horizon search or the screen's rays, where the scene has acceleration structures and the program is compiled: a pixel casts four rays (eight from a `screenProbeQuality` of 2, sixteen from 6), cosine distributed over its hemisphere, from its point moved `screenProbeShortRangeAOHardwareRayTracingNormalBias` metres (`0.001`) along its normal, as far as two tiles of pixels of the image's width at its depth; the first hit of an opaque surface blocks a ray, and the amount is the share left open. The short-range global illumination (`screenProbeShortRangeGI`) is not gathered while it runs. Run-time settings.

```js
const world = createWorld('viewer')
world.indirectLight = { screenProbeShortRangeAOHardwareRayTracing: true } // contact shadows from the scene's triangles
world.indirectLight = { screenProbeShortRangeAOHardwareRayTracingNormalBias: 0.002 } // start the rays 2 mm off the surface
world.indirectLight = { screenProbeShortRangeAOHardwareRayTracing: null } // back to the horizon search
```

```js
// The reflection ray of the pixel under the point (640, 360) of the display.
const world = createWorld('viewer', {
  reflectionVisualizeTraces: true,
  debugCursorX: 640,
  debugCursorY: 360,
})
```

```js
// The spheres at the probes of the finest level of the world's probes, twice their usual size.
const world = createWorld('viewer', {
  radianceCacheVisualize: 1,
  radianceCacheVisualizeRadiusScale: 2,
  radianceCacheVisualizeClipmapIndex: 0,
})
```

```js
// The scene traced from the camera, the far field read from the world's probes.
const world = createWorld('viewer', {
  visualizeSceneTraceRadianceCache: true,
  visualizeMaxTraceDistance: 20000,
})
world.diagnostic.mode = 'scene-visualization'
```

```js
// The material of the pixel at (640, 360): base colour, metalness, roughness, clear coat, anisotropy, cloth and emission, as text over the image.
const world = createWorld('viewer', { debugCursorX: 640, debugCursorY: 360 })
world.diagnostic.mode = 'material-properties'
```

```js
// The overview of the scene view: the geometry normals, the reflection view and the coverage, side by side (8 would show the albedo alone).
const world = createWorld('viewer', { visualizeMode: 1 })
```

```js
// The rays of the screen probe under the cursor, drawn against the depth (hidden behind surfaces), in the radiance through the display's table.
const world = createWorld('viewer', {
  screenProbes: 'high',
  screenProbeGatherVisualizeTraces: true,
  visualizeUseShaderPrintForTraces: false,
  debugCursorX: 640,
  debugCursorY: 360,
})
```

```js
// The rays of the screen probe under the point (640, 360) of the display, frozen as they are now.
const world = createWorld('viewer', {
  screenProbes: 'high',
  screenProbeGatherVisualizeTraces: true,
  screenProbeGatherVisualizeTracesFreeze: true,
  debugCursorX: 640,
  debugCursorY: 360,
})
```

```js
// The direct light's update table, and the boxes of the placements that have cards.
const world = createWorld('viewer', {
  surfaceCache: { surfaceCacheLightingStats: 1, surfaceCacheVisualizePrimitiveGroups: true },
})
world.diagnostic.mode = 'surface-cache-scene-stats' // or by mode: the counts of the scene
```

```js
// The cards and tiles the direct light update lights, the card under the cursor with its preview of the indirect light.
const world = createWorld('viewer', {
  surfaceCache: {
    surfaceCacheViewCards: true,
    surfaceCacheViewTiles: true,
    surfaceCacheCursorCard: true,
    surfaceCacheCursorCardLayer: 4,
  },
  debugCursorX: 640,
  debugCursorY: 360,
})
```

```js
// The spheres at the radiosity probes of the cards, 5 centimetres across, the probes on no surface in pink.
const world = createWorld('viewer', {
  surfaceCache: {
    surfaceCacheRadiosityVisualizeProbes: true,
    surfaceCacheRadiosityVisualizeProbeRadius: 5,
    surfaceCacheRadiosityVisualizeProbesShowInvalid: true,
  },
})
```
