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

`world.cut`: cut settings, each also a `createWorld` option. Every field, range, default and
behaviour: [Cut settings and draw distances](../../engine/webgpu-page-raster/cut-settings-and-draw-distances.md#cut-settings-and-draw-distances).

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
