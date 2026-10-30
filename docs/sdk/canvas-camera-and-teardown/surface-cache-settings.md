# Surface cache settings

`world.surfaceCache` holds the settings of the surface cache, also a `createWorld` option: the atlas
that keeps the captured surface of the meshes' cards (flat boxes along a mesh's faces, built by the
compiler), which the rays that leave the screen read where they hit a mesh. Each setting is the
reference's of that meaning, with its default, the row of the screen probes' level `ultra` (the
default; `cinematic` holds the same). The level `high` holds another row of the atlas's side, the
cards' density and resolutions, the lights a tile, the lighting's update factors and the radiosity's
probes (`SURFACE_CACHE_LEVEL_ROWS`), which a setting you name overrides. Lengths are in centimetres.

## Atlas and cards

- The atlas: `surfaceCacheAtlasSize` (`4096`, texels a side, cut into pages of 128) and
  `surfaceCacheResolution` (`1`, from 0.5: a factor on the pages along a side, held between 1 and
  64, and on the cards' resolutions).
- The resolution a card is kept at comes from its larger half side over the eye's distance, a metre
  at least:
  - `surfaceCacheCardTexelDensityScale` (`100`), `surfaceCacheCardMaxTexelDensity` (`0.2`);
  - `surfaceCacheCardMaxResolution` (`512`, up to 2048), `surfaceCacheCardMinResolution` (`2`);
  - `surfaceCacheOrthographicCardMinResolution` (`1`): an orthographic view's own least; `0` takes
    the plain one;
  - `surfaceCacheSceneDetail` (`1`, from 0.125 to 8): it divides the least resolution;
  - `surfaceCacheCardCaptureMargin` (`0`): added to the distance of the global distance field's
    outermost clipmap, past which a card is not kept.
- Which meshes get cards: `surfaceCacheMeshCardsMinSize` (`10`: the area a mesh's largest face must
  exceed is its square, a fifth of that for an emissive mesh) and `surfaceCacheMeshCardsCullFaces`
  (`true`: a card whose face is under that area is left out).
- A mesh a world cut at run time, which no compiler gave cards, has six axis-aligned cards made from
  its bounds, thickened by 5 cm, while `runtimeMeshCards` (`true`) is on; off, only the screen sees
  it in a reflection that leaves the screen.

## What an image does

- `surfaceCacheCardCapturesPerFrame` (`300` cards captured, the nearest first; the cards of twice as
  many meshes are added; `0` stops every capture), `surfaceCacheRemovesPerFrame` (`512`).
- `surfaceCacheGpuDrivenUpdate` (`false`, work in progress): a pass of the GPU tests every mesh's box
  against the eyes and lists the meshes to give cards and to take them from, read back a few images
  late and applied under the same limits; turn it on with `{ surfaceCacheGpuDrivenUpdate: true }`
  among the scene's settings.
- `surfaceCacheCardCaptureFactor` (`64`): the atlas's texels over those of the atlas the captured
  pages are drawn in.
- `surfaceCacheCardCaptureRefreshFraction` (`0.125`): the share spent capturing pages again, the
  oldest first, to follow the materials.
- `surfaceCacheCardCaptureEnableInvalidation` (`true`), `surfaceCacheNumFramesToKeepUnusedPages`
  (`256`).
- `surfaceCacheCompress` (`1`): `1` and `2` keep the atlas's albedo, normal and emission in
  block-compressed textures, BC7, BC5 and BC6H, a quarter of those layers' memory, where the device
  has `texture-compression-bc` and leave it uncompressed elsewhere; `1` is compression by writing
  through a view of another format, which WebGPU cannot do, so it takes the block copy of `2`, with
  the same result; `0` never.
- `surfaceCacheAllowCardSharing` (`true`): cards of one mesh with the same materials, face and
  proportions copy one capture. `surfaceCacheAllowCardDownsampleFromSelf` (`true`).
- `surfaceCacheCaptureLodScaleFactor` (`1`): the view's pixel error over it is the error the pages
  are drawn at.
- `surfaceCacheResampleLighting` (`true`), `surfaceCacheDilationMode` (`0`: 1 the two-sided meshes,
  2 all).
- `surfaceCacheDiffuseColorBoost` (`1`, up to `4`): the luminance of the albedo a read returns,
  raised to the power of its inverse.
- `surfaceCacheFastCameraMode` (`false`): lower density, half the greatest resolution, twice the
  captures.

The feedback that asks for finer pages: `surfaceCacheFeedback` (`true`), `surfaceCacheFeedbackTileSize`
(`16`, raised to a power of two), `surfaceCacheFeedbackMinPageHits` (`16`),
`surfaceCacheFeedbackUniqueElements` (`1024`) and `surfaceCacheFeedbackResLevelBias` (`-0.5`: levels
added to the one a ray's cone calls for).

## Lighting of the cards' texels

- `surfaceCacheDirectLightingUpdateFactor` (`32`) and `surfaceCacheRadiosityUpdateFactor` (`64`): the
  atlas's texels over the texels lit directly, and given indirect light, in an image, the pages left
  longest unlit first.
- `surfaceCacheLightingUpdateSpeed` (`1`, from 0.5 to 16): it divides both.
- `surfaceCacheLightingQuality` (`1`, from 0.5 to 6): it multiplies the radiosity probes' hemisphere
  by its square root and, from 6, halves their spacing.
- `surfaceCacheLightingForceFullUpdate` (`false`); `surfaceCacheFreezeUpdateFrame` (`0`; any other
  number stops the update clock and the pages' record of being lit, so that every image lights the
  same subset, for debugging).
- `surfaceCacheLightingMaxDistanceFromFrustumToPrioritize` (`500`, `-1` never): the pages near the
  frustum are lit twice as soon.
- `surfaceCacheLightingFeedback` (`true`): a page the rays read at its finest level in the last two
  images is lit at the greatest update speed, 4, where the scene has acceleration structures and
  `surfaceCacheDirectLightingHardwareRayTracing` is on.

### Direct lighting

- `surfaceCacheDirectLighting` (`true`); `surfaceCacheDirectLightingMaxLightsPerTile` (`8`, up to
  32, a power of two).
- `surfaceCacheDirectLightingBatchShadows` (`2`, from 0 to 2): the tiles of each light are gathered
  into a run before the masks and the light functions are made over them. At `2` the point lights',
  the spots' and the rectangles' tiles are each gathered by their type; at `0` and `1` each light
  has a run of its own. The image is the same.
- `surfaceCacheDirectLightingGlobalSdfShadowRayBias` (`1`): voxels the shadow ray starts off the
  surface, three where it grazes the light.
- `surfaceCacheDirectLightingCloudTransmittance` (`true`).

Where the scene has acceleration structures the direct light's shadow is traced through the scene's
triangles instead:

- `surfaceCacheDirectLightingHardwareRayTracing` (`true`; `false` keeps the distance field's ray)
  keeps, for each light of a tile, a mask of the tile's texels (the light function and the clouds'
  shade, then whether a ray must settle it), and one ray goes from each texel the mask leaves open.
- `surfaceCacheDirectLightingHardwareRayTracingShadowRayBias` (`1` cm off the texel, three where it
  grazes the light) and `…EndBias` (`1` cm: a lamp's ray stops short of it).
- `…AdaptiveShadowTracing` (`true`): a tile that every texel saw a light at, or none did, at its last
  update traces one texel of each quad of four, a different one each update.
- `…ForceTwoSided` (`false`): the front faces of a primitive that is not two-sided are culled;
  `true` takes all as two-sided.
- `surfaceCacheDirectLightingStochastic` (`false`, experimental, with the shadows traced): each
  texel is lit by `surfaceCacheDirectLightingStochasticSamplePerTexel` (`1`, up to 4, 3 taken as 4)
  lights picked among those of its tile with a chance proportional to `log2(1 + luminance)`, a light
  under `surfaceCacheDirectLightingStochasticMinWeight` (`0.001`) never picked, and only the picked
  ones traced. `…StochasticTemporal` (`true`) blends the result over at most
  `…StochasticTemporalMaxFramesAccumulated` (`12`) images, the history held within
  `…StochasticTemporalNeighborhoodClampScale` (`2`) standard deviations of the texel's 5 × 5
  neighbours. Example:
  `world.surfaceCache = { surfaceCacheDirectLightingStochastic: true, surfaceCacheDirectLightingStochasticSamplePerTexel: 2 }`.
- `surfaceCacheHardwareRayTracingMaxIterations` (`8192` triangles a ray may test; a ray that stopped
  counts as blocked).

### Radiosity

- `surfaceCacheRadiosity` (`true`), `surfaceCacheRadiosityProbeSpacing` (`4`, texels, a power of two
  up to 8), `surfaceCacheRadiosityHemisphereProbeResolution` (`4`, up to 16).
- `surfaceCacheRadiositySpatialFilterProbes` (`true`) with its `…KernelSize` (`1`: 0 none, 1 four
  neighbours, 2 thirteen).
- `surfaceCacheRadiosityProbePlaneWeighting` (`true`) with its `…DepthScale` (`-100`).
- `surfaceCacheRadiosityMaxRayIntensity` (`40`, times the exposure).
- For its rays through the global distance field: `surfaceCacheRadiosityDistanceFieldSurfaceBias`
  (`10` cm along a ray before it can hit) and `…SurfaceSlopeBias` (`5` cm off the texel).
- Where the scene has acceleration structures and its cut draws no cell of the world DAG,
  `surfaceCacheRadiosityHardwareRayTracing` (`true`) casts them through the scene's triangles
  instead, from `…HardwareRayTracingNormalBias` (`0.1` cm off the texel along its normal) and
  `…HardwareRayTracingBias` (`0.1` cm along the ray), the translucent primitives passed. The cards of
  the primitive hit are read at the hit with
  `surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias` (`10` cm); no light comes from a hit
  nearer than `surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache` (`10` cm) or on
  the back of a one-sided primitive; a trace that stopped is black and a miss the sky.
- `surfaceCacheHardwareRayTracingAvoidSelfIntersections` (`3`: 0 culls the back faces, 1 traces
  again from past a near hit, 2 and 3 pass the near hits as the ray travels) with
  `surfaceCacheHardwareRayTracingSkipBackFaceHitDistance` (`5` cm) and `…SkipTwoSidedHitDistance`
  (`1` cm) keeps a ray off the geometry it starts on.
- `rayTracingExcludeSky` (`true`) leaves the primitives of a sky material (the compiler's `sky`
  property) out of every ray through the scene's triangles, the path tracer's excepted, which always
  meets them: `world.surfaceCache = { rayTracingExcludeSky: false }` includes the dome.
- `surfaceCacheRadiosityTemporal` (`true`) with its `…MaxFramesAccumulated` (`4`) and
  `…FixedJitterIndex` (`-1`: the probes' jitter moves).

## Reading and writing

A read of the cards finds each texel's final light, its albedo over π times its direct and indirect
light plus its emission; the lighting settles over some hundred images after a change, and the frame
is not held while it does. The capture's raster is not plugged in yet, so on an image today the cards
hold no surface to light. A write names the settings it changes, `null` one's default; a value of
another kind is refused by name. A change that alters the atlas's pages, the compression, the
sharing or the downsampling empties the atlas. A scene whose meshes carry no cards is not touched.

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

`rayTracingEnable` (`true`, the value of a new project) is the one switch the features that cast
rays through the scene's triangles hang on. On, each takes its own setting; `false` makes every one
of them read `false` whatever it is itself, so each marches the distance fields, as a project with
ray tracing off does:

- `reflectionHardwareRayTracing`, `screenProbeHardwareRayTracing`,
  `screenProbeRadianceCacheHardwareRayTracing`, `screenProbeShortRangeAOHardwareRayTracing`,
  `surfaceCacheDirectLightingHardwareRayTracing`, `surfaceCacheRadiosityHardwareRayTracing`,
  `translucencyGiHardwareRayTracing`, `heterogeneousVolumesHardwareRayTracing`,
  `visualizeHardwareRayTracing` and `sampledLightsHardwareRayTracing`.

The settings keep their values: `rayTracingEnable` back to `true` gives them back. It is a run-time
setting, written by `world.rayTracing`, the session's `setRayTracing` or the
`trillion3d_set_ray_tracing` tool.

```ts
world.rayTracing = { rayTracingEnable: false } // every feature traces the distance fields, as a project with ray tracing off
world.rayTracing = { rayTracingEnable: null } // back to the default: each feature follows its own setting
```
