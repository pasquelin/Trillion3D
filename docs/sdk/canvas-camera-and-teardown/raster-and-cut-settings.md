# Raster and cut settings

## Software raster and depth bucketing

- `world.softwareRaster` (also a `createWorld` option, `true` by default) rasters in compute each
  cluster whose longest edge projects under `world.hardwareRasterEdgePixels` (also an option, `32`
  by default, a finite number of pixels above zero) and whose box crosses neither clip plane. Every
  other cluster goes to the hardware rasterizer; `false` hands it every one.
- `world.depthBucketing` (also an option, `true` by default, the reference's) rasters the software
  raster's cutout clusters nearest first, so that a hidden cutout pixel leaves before its texture is
  read. Each cluster is put in one of 256 buckets spread by the logarithm of the view depth of its
  box between `world.depthBucketsMinZ` (`10`) and `world.depthBucketsMaxZ` (`1000`), in metres,
  finite numbers above zero (the reference's centimetres, `1000` and `100000`). As in the reference,
  the order is made only where the scene holds voxels; it never changes a pixel.

All five are render settings: the page's value holds over the quality preset, a write applies next
frame, and a value of another kind is refused by name.

```js
const world = createWorld('viewer', { softwareRaster: true, hardwareRasterEdgePixels: 32 })
world.softwareRaster = false // every cluster on the hardware rasterizer, from the next frame
world.hardwareRasterEdgePixels = 16 // fewer clusters on the software raster
world.depthBucketing = false // the cutout clusters unordered
world.depthBucketsMaxZ = 500 // the buckets end at 500 m
```

## The cut

`world.cut` holds the cut's settings, each also a `createWorld` option:

- `cutTwoPassOcclusion` (`true`): the main view tests what it cuts against the previous image's
  depth, then what that hid against the depth it just drew.
- `cutOcclusionCulling`, `cutFrustumCulling` and `cutMinLodCulling` (`true`): each test on.
- `cutDrawDistanceCulling` (`true`): an object that names a draw distance (`drawDistance`,
  [COMPILER.md](../../compiler/the-partitions-grids.md#object-settings)) is culled outside it, in the cut,
  in the sun's shadows and in the rays' scene. `false`: every instance of an instanced mesh is drawn
  at every distance, while an object of its own is always culled by its distances.
- `cutDistanceCullToSphereEdge` (`true`): an object's draw distance is measured to the edge of the
  sphere of its bounds; `false`, to its centre.
- `cutViewDistanceScale` (`1`, a finite number of at least 0): the scale every draw distance is
  multiplied by; the quality levels write it, 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at `fine`, 1
  at `max`, 10 at `cinematic`.
- A second scale of the draw distances, applied beside the first once the switch is on:
  `cutViewDistanceApplySecondaryScale` (`false`) and `cutViewDistanceSecondaryScale` (`1`).
- `cutViewDistanceFovMinAngle` (`45`) and `cutViewDistanceFovMaxAngle` (`90`), two horizontal fields
  of view in degrees from 0 to 360, with `cutViewDistanceFovMinAngleScale` and
  `cutViewDistanceFovMaxAngleScale` (`1` both, 0 or more): the scale the draw distances of an object
  of its own take at the first angle and under, at the second and over, and linearly between. An
  orthographic view counts as 0 degrees; at 1 and 1 nothing changes.
- `cutEdgeScaleBudgetMs` (`0`, none) and `cutEdgeScaleMinPercent` (`30`): a GPU time budget for the
  main view's cut and its raster that coarsens its threshold, no further than that share of its
  scale, while the render scale is `'auto'`.
- `cutLodBiasFollowsUpscale` (`true`): an upscaled image's screen error follows the display over the
  render width. `cutLodBiasOffset` (`0`) and `cutLodBiasMin` (`-2`) are that bias's offset and floor
  in powers of two.
- The caps of its lists: `cutMaxNodes` (`2097152`), `cutMaxCandidateClusters` (`16777216`) and
  `cutMaxVisibleClusters` (`4194304`). Past one, the cut draws what fits and warns.

Of these only `cutViewDistanceScale` is written by a quality level: a value the page set holds over
the preset. A write names the settings it changes, `null` one's default; a value of another kind is
refused by name ([ENGINE.md](../../engine/webgpu-page-raster.md#webgpu-page-raster)).

```js
const world = createWorld('viewer', { cutTwoPassOcclusion: true })
world.cut = { cutLodBiasFollowsUpscale: false } // the screen error ignores the upscale, next frame
world.cut = { cutViewDistanceScale: 0.5 } // every object's draw distance halved
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
world.cut = { cutEdgeScaleBudgetMs: 6 } // with renderScale 'auto': the cut coarsens above 6 ms
```
