# Surface cache settings

`world.surfaceCache` (also a `createWorld` option): atlas of captured surfaces of meshes' cards.
Defaults = screen probes' level `ultra` row (`cinematic` same); level `high` has another row
(`SURFACE_CACHE_LEVEL_ROWS`); a named setting overrides. Lengths in cm.

## Atlas and cards

- `surfaceCacheAtlasSize` (`4096`, texels a side, pages of 128), `surfaceCacheResolution` (`1`, from
  0.5: factor on pages a side, held 1 to 64, and on card resolutions).
- Card resolution: `surfaceCacheCardTexelDensityScale` (`100`), `surfaceCacheCardMaxTexelDensity`
  (`0.2`), `surfaceCacheCardMaxResolution` (`512`, up to 2048), `surfaceCacheCardMinResolution`
  (`2`), `surfaceCacheOrthographicCardMinResolution` (`1`; `0` takes the plain one),
  `surfaceCacheSceneDetail` (`1`, 0.125 to 8: divides the least resolution),
  `surfaceCacheCardCaptureMargin` (`0`: added to the global distance field's outermost clipmap
  distance, past which a card is not kept).
- `surfaceCacheMeshCardsMinSize` (`10`: largest face area must exceed its square, a fifth if
  emissive), `surfaceCacheMeshCardsCullFaces` (`true`).
- `runtimeMeshCards` (`true`): a run-time mesh with no compiler cards gets six axis-aligned 5 cm
  cards from its bounds, 5 cm thick; off: only the screen sees it in a reflection leaving the
  screen.

## What an image does

- `surfaceCacheCardCapturesPerFrame` (`300`, nearest first; `0` stops captures),
  `surfaceCacheRemovesPerFrame` (`512`).
- `surfaceCacheGpuDrivenUpdate` (`false`, work in progress): a GPU pass lists meshes to give cards
  and take them from, read back a few images late.
- `surfaceCacheCardCaptureFactor` (`64`), `surfaceCacheCardCaptureRefreshFraction` (`0.125`),
  `surfaceCacheCardCaptureEnableInvalidation` (`true`), `surfaceCacheNumFramesToKeepUnusedPages`
  (`256`).
- `surfaceCacheCompress` (`1`): `1` and `2` keep albedo, normal, emission in BC7, BC5, BC6H where
  the device has `texture-compression-bc` (a quarter of the memory), uncompressed elsewhere; `1`
  would compress by writing through another format's view, impossible in WebGPU, so it takes `2`'s
  block copy, same result; `0` never.
- `surfaceCacheAllowCardSharing` (`true`), `surfaceCacheAllowCardDownsampleFromSelf` (`true`),
  `surfaceCacheCaptureLodScaleFactor` (`1`), `surfaceCacheResampleLighting` (`true`),
  `surfaceCacheDilationMode` (`0`: 1 two-sided meshes, 2 all).
- `surfaceCacheDiffuseColorBoost` (`1`, up to `4`), `surfaceCacheFastCameraMode` (`false`: lower
  density, half the greatest resolution, twice the captures).
- Feedback asking for finer pages: `surfaceCacheFeedback` (`true`), `surfaceCacheFeedbackTileSize`
  (`16`, raised to a power of two), `surfaceCacheFeedbackMinPageHits` (`16`),
  `surfaceCacheFeedbackUniqueElements` (`1024`), `surfaceCacheFeedbackResLevelBias` (`-0.5`).

## Lighting of the cards' texels

- `surfaceCacheDirectLightingUpdateFactor` (`32`), `surfaceCacheRadiosityUpdateFactor` (`64`):
  atlas texels over texels lit per image.
- `surfaceCacheLightingUpdateSpeed` (`1`, 0.5 to 16): divides both.
- `surfaceCacheLightingQuality` (`1`, 0.5 to 6): multiplies radiosity hemisphere by its square
  root; from 6, halves probe spacing.
- `surfaceCacheLightingForceFullUpdate` (`false`); `surfaceCacheFreezeUpdateFrame` (`0`; other
  numbers stop the update clock).
- `surfaceCacheLightingMaxDistanceFromFrustumToPrioritize` (`500`, `-1` never): pages within that distance of the frustum are lit twice as soon.
- `surfaceCacheLightingFeedback` (`true`): a page read at finest level in the last two images is
  lit at update speed 4 (needs acceleration structures and direct-lighting ray tracing).

### Direct lighting

- `surfaceCacheDirectLighting` (`true`), `surfaceCacheDirectLightingMaxLightsPerTile` (`8`, up to
  32, power of two), `surfaceCacheDirectLightingBatchShadows` (`2`, 0 to 2),
  `surfaceCacheDirectLightingGlobalSdfShadowRayBias` (`1` voxel),
  `surfaceCacheDirectLightingCloudTransmittance` (`true`).
- `surfaceCacheDirectLightingHardwareRayTracing` (`true`; `false` keeps the distance-field ray):
  shadows traced through the triangles, one ray per texel a light mask leaves open. Then
  `…ShadowRayBias` (`1` cm), `…EndBias` (`1` cm), `…AdaptiveShadowTracing` (`true`),
  `…ForceTwoSided` (`false`).
- `surfaceCacheDirectLightingStochastic` (`false`, experimental):
  `surfaceCacheDirectLightingStochasticSamplePerTexel` (`1`, up to 4, 3 taken as 4) lights picked
  per texel with chance proportional to `log2(1 + luminance)`;
  `surfaceCacheDirectLightingStochasticMinWeight` (`0.001`); `…StochasticTemporal` (`true`),
  `…StochasticTemporalMaxFramesAccumulated` (`12`), `…StochasticTemporalNeighborhoodClampScale`
  (`2`). Example: `{ surfaceCacheDirectLightingStochastic: true,
  surfaceCacheDirectLightingStochasticSamplePerTexel: 2 }`.
- `surfaceCacheHardwareRayTracingMaxIterations` (`8192` triangles a ray tests; stopped = blocked).

### Radiosity

- `surfaceCacheRadiosity` (`true`), `surfaceCacheRadiosityProbeSpacing` (`4`, texels, power of two up
  to 8), `surfaceCacheRadiosityHemisphereProbeResolution` (`4`, up to 16).
- `surfaceCacheRadiositySpatialFilterProbes` (`true`) with `…KernelSize` (`1`: 0 none, 1 four
  neighbours, 2 thirteen); `surfaceCacheRadiosityProbePlaneWeighting` (`true`) with `…DepthScale`
  (`-100`); `surfaceCacheRadiosityMaxRayIntensity` (`40`, times exposure).
- Distance-field rays: `surfaceCacheRadiosityDistanceFieldSurfaceBias` (`10` cm),
  `…SurfaceSlopeBias` (`5` cm).
- `surfaceCacheRadiosityHardwareRayTracing` (`true`; needs acceleration structures and a cut with no
  world DAG cell): triangle rays from `…HardwareRayTracingNormalBias` (`0.1` cm) and
  `…HardwareRayTracingBias` (`0.1` cm); hit cards read with
  `surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias` (`10` cm); no light from a hit under
  `surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache` (`10` cm) or on a one-sided
  back; stopped trace is black, miss is sky.
- `surfaceCacheHardwareRayTracingAvoidSelfIntersections` (`3`: 0 culls back faces, 1 retraces past a
  near hit, 2 and 3 pass near hits), `surfaceCacheHardwareRayTracingSkipBackFaceHitDistance`
  (`5` cm), `…SkipTwoSidedHitDistance` (`1` cm).
- `rayTracingExcludeSky` (`true`): sky-material primitives (compiler `sky` property) are left out of
  every triangle ray except the path tracer's.
- `surfaceCacheRadiosityTemporal` (`true`), `…MaxFramesAccumulated` (`4`), `…FixedJitterIndex`
  (`-1`: jitter moves).

## Reading and writing

A card read returns albedo over π times direct and indirect light, plus emission. Limit: the
capture's raster is not plugged in yet, so cards hold no surface to light. A write names changed
settings, `null` restores a default; a value of another kind is refused by name. A change to atlas
pages, compression, sharing or downsampling empties the atlas.

```js
const world = createWorld('viewer', { surfaceCacheAtlasSize: 2048 }) // a smaller atlas, in less memory
world.surfaceCache = { surfaceCacheCardCapturesPerFrame: 150 } // half the captures of an image
world.surfaceCache = { surfaceCacheFeedback: false } // only the coarsest level of each card is kept
world.surfaceCache = { surfaceCacheGpuDrivenUpdate: true } // a GPU pass lists the meshes to give cards and to take them from, read back a few images late
world.surfaceCache = { surfaceCacheCompress: 0 } // the colour layers stay plain: four times the memory, no block loss
world.surfaceCache = { rayTracingExcludeSky: false } // the rays meet a sky dome too
world.surfaceCache = { surfaceCacheAtlasSize: null, surfaceCacheCardCapturesPerFrame: null } // back to the defaults
```

## Ray tracing switch

`rayTracingEnable` (`true`): `false` makes these read `false`, so each marches distance fields:

- `reflectionHardwareRayTracing`, `screenProbeHardwareRayTracing`,
  `screenProbeRadianceCacheHardwareRayTracing`, `screenProbeShortRangeAOHardwareRayTracing`,
  `surfaceCacheDirectLightingHardwareRayTracing`, `surfaceCacheRadiosityHardwareRayTracing`,
  `translucencyGiHardwareRayTracing`, `heterogeneousVolumesHardwareRayTracing`,
  `visualizeHardwareRayTracing`, `sampledLightsHardwareRayTracing`.

Written by `world.rayTracing`, session `setRayTracing` or tool `trillion3d_set_ray_tracing`.

```ts
world.rayTracing = { rayTracingEnable: false } // every feature traces the distance fields, as a project with ray tracing off
world.rayTracing = { rayTracingEnable: null } // back to the default: each feature follows its own setting
```
