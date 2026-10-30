# Hair strands: compute raster
`hairVisibilityComputeRaster` (`false`) makes a compute raster write the samples of the strands' visibility in place of the device's rasterizer. It bins the segments of the strands into tiles of the image, then draws each tile with a group of threads. The furthest opaque depth of each tile is found first, so that a segment behind every opaque pixel of a tile is not binned into it. The other settings choose how the segments reach their pixels; each default is the reference's.

| Setting | Default | Meaning |
| --- | --- | --- |
| `hairVisibilityNaiveRaster` | `false` | draw the segments a thread a segment, the ribbons that span more than a tile shared by a group of threads, instead of binning them |
| `hairVisibilityTileCompaction` | `false` | merge the partly filled tiles the binners made in the same cell into full tiles before they are drawn |
| `hairVisibilityClassification` | `false` | sort the segments first: the small ones go to the tiles (or to the naive raster), the larger ones are drawn a thread a segment |
| `hairVisibilityComputeRasterTileSize` | `32` | side in pixels of a tile, from `8` to `32`, rounded down to a power of two |
| `hairVisibilityComputeRasterNumBinners` | `32` | workgroups that bin the segments (`1` to `256`) |
| `hairVisibilityComputeRasterNumRasterizers` | `256` | workgroups that draw the tiles (`1` to `1024`) |
| `hairVisibilityComputeRasterNumRasterizersNaive` | `256` | workgroups of the naive raster (`1` to `1024`) |
| `hairVisibilityNumClassifiers` | `32` | workgroups of the classification (`1` to `256`) |
| `hairVisibilityComputeRasterMaxTiles` | `65536` | most tiles kept, from `1024` to `262144`; a tile holds 256 segments, and a device whose storage binding holds fewer tiles takes the most it holds; segments past them are not drawn |

```js
// Strands drawn by the compute raster, its tiles compacted and its segments classified.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVisibilityComputeRaster: true,
  hairVisibilityTileCompaction: true,
  hairVisibilityClassification: true,
})
```
