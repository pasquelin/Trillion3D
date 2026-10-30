# Raster and cut settings

## Software raster and depth bucketing

- `world.softwareRaster` (also `createWorld` option, `true`): rasters in compute each cluster whose
  longest edge projects under `world.hardwareRasterEdgePixels` (also option, `32`, finite pixels
  above zero) and whose box crosses neither clip plane. Others go to the hardware rasterizer;
  `false` sends all.
- `world.depthBucketing` (also option, `true`): software raster's cutout clusters rasterize nearest
  first. Each cluster goes in one of 256 buckets spread by log of its box's view depth between
  `world.depthBucketsMinZ` (`10`) and `world.depthBucketsMaxZ` (`1000`), metres, finite numbers
  above zero (reference centimetres, `1000` and `100000`). As reference, ordering happens only where
  the scene holds voxels; never changes a pixel.

All five are render settings: the page's value holds over the quality preset, a write applies next
frame, a value of another kind is refused by name.

```js
const world = createWorld('viewer', { softwareRaster: true, hardwareRasterEdgePixels: 32 })
world.softwareRaster = false // every cluster on the hardware rasterizer, from the next frame
world.hardwareRasterEdgePixels = 16 // fewer clusters on the software raster
world.depthBucketing = false // the cutout clusters unordered
world.depthBucketsMaxZ = 500 // the buckets end at 500 m
```

## The cut

`world.cut`: cut settings, each also a `createWorld` option:

- `cutTwoPassOcclusion` (`true`): main view tests against the previous image's depth, then what that
  hid against the depth just drawn.
- `cutOcclusionCulling`, `cutFrustumCulling`, `cutMinLodCulling` (`true`): each test on.
- `cutDrawDistanceCulling` (`true`): an object naming a draw distance (`drawDistance`,
  [COMPILER.md](../../compiler/the-partitions-grids.md#object-settings)) is culled outside it, in
  the cut, sun shadows and the rays' scene. `false`: every instance of an instanced mesh draws at
  every distance; an object of its own is still culled.
- `cutDistanceCullToSphereEdge` (`true`): draw distance measured to the bounds sphere's edge;
  `false`, its centre.
- `cutViewDistanceScale` (`1`, finite, at least 0): multiplier on every draw distance; quality
  levels write it: 0.4 `smooth`, 0.6 `balanced`, 0.8 `fine`, 1 `max`, 10 `cinematic`.
- `cutViewDistanceApplySecondaryScale` (`false`), `cutViewDistanceSecondaryScale` (`1`): second
  scale, applied beside the first once on.
- `cutViewDistanceFovMinAngle` (`45`), `cutViewDistanceFovMaxAngle` (`90`): horizontal fields of
  view in degrees, 0 to 360, with `cutViewDistanceFovMinAngleScale` and
  `cutViewDistanceFovMaxAngleScale` (`1` both, 0 or more): scale an object of its own's draw
  distances take at the first angle and under, at the second and over, linear between. Orthographic
  view counts as 0 degrees.
- `cutEdgeScaleBudgetMs` (`0`, none), `cutEdgeScaleMinPercent` (`30`): GPU time budget for the main
  view's cut and raster, coarsening its threshold no further than that share of its scale, while
  render scale is `'auto'`.
- `cutLodBiasFollowsUpscale` (`true`): screen error follows display over render width.
  `cutLodBiasOffset` (`0`), `cutLodBiasMin` (`-2`): that bias's offset and floor in powers of two.
- List caps: `cutMaxNodes` (`2097152`), `cutMaxCandidateClusters` (`16777216`),
  `cutMaxVisibleClusters` (`4194304`). Past one, the cut draws what fits and warns.

Only `cutViewDistanceScale` is written by a quality level. A write names changed settings, `null`
restores a default; a value of another kind is refused by name
([ENGINE.md](../../engine/webgpu-page-raster.md#webgpu-page-raster)).

```js
const world = createWorld('viewer', { cutTwoPassOcclusion: true })
world.cut = { cutLodBiasFollowsUpscale: false } // the screen error ignores the upscale, next frame
world.cut = { cutViewDistanceScale: 0.5 } // every object's draw distance halved
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
world.cut = { cutEdgeScaleBudgetMs: 6 } // with renderScale 'auto': the cut coarsens above 6 ms
```
