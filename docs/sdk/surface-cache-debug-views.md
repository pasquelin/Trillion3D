# Surface cache: debug views
Tables and boxes over the image, as a diagnostic mode or a setting (`world.surfaceCache`); a mode shows its view whatever the setting says.
| Mode | Setting | Default | What it shows |
| - | - | - | - |
| `surface-cache-direct-stats` | `surfaceCacheLightingStats: 1` | `0` | direct update table: tiles per priority bucket (16), `MaxBucket`, `MaxTilesFromMaxBucket`, pages and tiles lit; read back late |
| `surface-cache-indirect-stats` | `surfaceCacheLightingStats: 2` | `0` | same for the indirect (radiosity) update |
| `surface-cache-direct-lighting-stats` | `surfaceCacheLightingStats: 3` | `0` | `#Lights`, `Batched Lights`, `Standalone Lights`, `AtlasResolution`, `UpdateAtlasSize`, `MaxUpdateTiles`, `UpdateFactor`, `Method`, `RT Traces` (groups of 64, overestimate), cards and tiles updated |
| `surface-cache-scene-stats` | `surfaceCacheSceneStats` | `false` | `NumPrimitiveGroups`, `NumMeshCards`, `NumCards`, `AddOps`, `RemoveOps` (placements that gained or lost mesh cards; first seven ids) |
| `surface-cache-primitive-groups` | `surfaceCacheVisualizePrimitiveGroups` | `false` | white box per placement with mesh cards (first 1300; 16384 segments) |
| none | `surfaceCacheViewCards` | `false` | green box of each card the direct update lights |
| none | `surfaceCacheViewTiles` | `false` | yellow box of each 8x8 texel tile the direct update lights |
| none | `surfaceCacheCursorCard` | `false` | card under the cursor (`debugCursorX`, `debugCursorY`): red box, purple tile, bottom-left preview of layer `surfaceCacheCursorCardLayer` (`3`; 0 to 4: albedo, normal, emission, direct, indirect) |
| none | `surfaceCacheRadiosityVisualizeProbes` | `false` | sphere per radiosity probe (every `surfaceCacheRadiosityProbeSpacing` texels), radius `surfaceCacheRadiosityVisualizeProbeRadius` (`10` cm); `surfaceCacheRadiosityVisualizeProbesShowInvalid` (`false`) adds off-surface probes, pink. Needs `surfaceCacheRadiosity` |

Screen and world probe tables:

| Mode | Setting | Default | What it shows |
| - | - | - | - |
| `radiance-cache-stats` | `screenProbeRadianceCacheStats` | `false` | `MaxProbesInAtlas`, `ProbesInAtlas`, `Unfilled`, `Refreshing`, `Refused`, `Traced Probes`, `Marked` |
| `screen-probe-gather-debug` | `screenProbeGatherDebug` | `false` | `NumScreenProbes`, `NumUniformScreenProbes`, `NumAdaptiveScreenProbes` |
| `screen-probe-tile-stats` | `screenProbeTileDebugMode` | `false` | tile counts of `Simple`, `ImportanceSample`, `All` (green, orange, cyan) and total (needs `screenProbeIntegrationTileClassification`) |
| `screen-probe-placement` | `screenProbeGatherDebugProbePlacement` | `0` | `1` quad per probe (yellow uniform, magenta adaptive), `2` adaptive only, `3` 2 cm cross and 10 cm normal line; max 262144 lines (mode shows `1`) |
| `screen-probe-traces` | `screenProbeGatherVisualizeTraces` | `false` | rays of the probe nearest the cursor (image middle if none), coloured by radiance; a ray ending within 1 cm is red, 5 cm long. `screenProbeGatherVisualizeTracesFreeze` (`false`) keeps the last rays; `visualizeUseShaderPrintForTraces` (`true`), `false` depth-tests lines; `visualizeToneMap` (`true`), `false` display transfer alone; `debugCursorX`, `debugCursorY` (`-1`, none) display pixels |
| `reflection-traces` | `reflectionVisualizeTraces` | `false` | reflection ray of the pixel under the cursor (`debugCursorX`, `debugCursorY`): line, 2 cm yellow cross at its end, texel, distance and radiance as text; needs traced reflections |
| `radiance-cache-probes` | `radianceCacheVisualize` | `0` | sphere per world probe, coloured by irradiance (albedo 0.3; inside a surface red, moved green, adaptive cyan) or radiance; `2` share of rays that left the scene; `radianceCacheVisualizeRadiusScale` (`1`), `radianceCacheVisualizeClipmapIndex` (`-1`, all; finest 0) |
| `scene-visualization` | none (mode only) | - | scene traced from the camera through the global distance field, replacing the image. `visualizeSceneTraceRadianceCache` (`false`) ends the trace where world probes cover the eye and reads their light; `visualizeHiResSurface` (`true`) finest page; `visualizeMinTraceDistance` (`0`, min `0.01`), `visualizeMaxTraceDistance` (`100000`) cm; `visualizeToneMap` (`true`). `visualizeMode` (`0`) shows the view alone: 1 overview, 3 scene, 4 reflection view, 5 coverage (pink: cards but none cover; yellow: none), 6 geometry normals, 7 dedicated reflection ray pixels, 8 albedo, 9 normals, 10 emission, 11 card weights, 12 direct, 13 indirect, 16/17 images since direct/indirect update, 18/19 last page use, 20 lights per tile, 21 card sharing, 24 radiosity images. Orthographic: rays follow the view direction; height fog (`reflectionHeightFog`, `reflectionMinDistanceForFoggingSky`) applies. `visualizeSurfaceCacheFeedback` (`false`) enables 18/19; `visualizeHardwareRayTracing` (`true`) traces triangles where present; `visualizeCullingMode` (`0`; `1` back, `2` front faces) names the faces rays pass. Example: `{ "visualizeMode": 3, "visualizeHardwareRayTracing": true, "visualizeCullingMode": 1 }` |
| `material-properties` | none (mode only) | - | text for the cursor pixel (middle if none): `Closure Count`, `Material Mode` (None, Unlit, Physical, Diffuse, Toon, Shadow catcher, Debug view; plus shading model, ` - Legacy Clear Coat` / ` - Legacy Cloth`), `AO`, `TopRoughness`, closure type (`Slab`, `Hair`, `Eye`, `Unlit`), `BasisType` (`Normal`, `Nor+Tan`), normal, `Diffuse`, `F0`, `Specular`, `Roughness`, `Anisotropy`, `Clear coat`, `Fuzz`, `Emissive` |

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

`reflectionRadianceCache` (`false`): rough reflections read the screen probes' radiance cache (`screenProbeRadianceCache`, default on) instead of tracing the whole ray. A pixel whose roughness plus noise of width `reflectionRadianceCacheRoughnessFadeLength` (`0.05`) passes `reflectionRadianceCacheMinRoughness` (`0.2`), with all eight probes covering its point, casts a ray shortened from `reflectionRadianceCacheMaxTraceDistance` (`5000` cm) to `reflectionRadianceCacheMinTraceDistance` (`1000` cm) at `reflectionRadianceCacheMaxRoughness` (`0.35`), clamped to the cache's required distance and the view's longest ray. A ray hitting nothing takes the cache's light; the far screen trace is off. `reflectionRadianceCacheStochasticInterpolation` (`true`) reads one probe drawn by weight, `false` weighs all eight; `reflectionRadianceCacheReprojectionRadiusScale` (`10`, 1 to 100000) scales each probe's sphere. Run-time.

```js
const world = createWorld('viewer')
world.reflections = { reflectionRadianceCache: true } // rough reflections read the cache past a short ray
world.reflections = { reflectionRadianceCacheMaxTraceDistance: 2000, reflectionRadianceCacheMinTraceDistance: 500 } // shorter rays, centimetres
world.reflections = { reflectionRadianceCacheStochasticInterpolation: false } // the eight probes, weighed
world.reflections = { reflectionRadianceCache: null } // back to the default, off
```

## Translucent surfaces that reflect the scene

A blended, water or transmissive surface that is not the traced front layer (`reflectionFrontLayer`, off by default) reflects, in order: `reflectionTranslucencyRadianceCache` (`true`) reads the radiance cache where all eight probes cover the point; else the environment through its lobe. Then `reflectionTranslucencyScreenQuality` (`3`, 0 to 4; 0 off, 1 to 4 the same 12-step march) marches the last lit image's depth pyramid (if not cut); a hit, faded at borders and by `saturate(2 - 6.6 * roughness)`, replaces the answer above by its alpha share; weighed by reflectance. With fewer than 23 sampled textures a stage, or a `lightingDataFormat` other than `r11g11b10`: the traced front layer where there is one, else the environment. Run-time.

```js
const world = createWorld('viewer')
world.reflections = { reflectionTranslucencyRadianceCache: false } // glass and water reflect the environment, then the last image
world.reflections = { reflectionTranslucencyScreenQuality: 0 } // the cache or the environment alone, no march of the last image
world.reflections = { reflectionTranslucencyScreenQuality: null } // back to the default, 3
```

## Short-range occlusion through the scene's triangles

`screenProbeShortRangeAOHardwareRayTracing` (`false`) casts the short-range occlusion and bent normal through the scene's triangles instead of the horizon search, where the scene has acceleration structures: 4 cosine-distributed rays per pixel (8 from `screenProbeQuality` 2, 16 from 6), from its point moved `screenProbeShortRangeAOHardwareRayTracingNormalBias` m (`0.001`) along the normal, up to two pixel tiles of the image width at its depth; the first opaque hit blocks; occlusion is the share left open. `screenProbeShortRangeGI` is not gathered meanwhile. Run-time.

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
