# Hair strands: compute raster

`hairVisibilityComputeRaster` (`false`) makes a compute raster write the strands' visibility samples
in place of the device's rasterizer. It bins the strands' segments into image tiles, then draws each
tile with a group of threads. Each tile's furthest opaque depth is found first, so a segment behind
every opaque pixel of a tile is not binned into it. The other settings choose how segments reach
their pixels; each default is the reference's.

| Setting | Default | Meaning |
| - | - | - |
| `hairVisibilityNaiveRaster` | `false` | draw the segments a thread a segment, ribbons spanning more than a tile shared by a group of threads, instead of binning |
| `hairVisibilityTileCompaction` | `false` | merge the partly filled tiles the binners made in the same cell into full tiles before drawing |
| `hairVisibilityClassification` | `false` | sort the segments first: small ones go to the tiles (or the naive raster), larger ones are drawn a thread a segment |
| `hairVisibilityComputeRasterTileSize` | `32` | tile side in pixels, `8` to `32`, rounded down to a power of two |
| `hairVisibilityComputeRasterNumBinners` | `32` | workgroups binning the segments (`1` to `256`) |
| `hairVisibilityComputeRasterNumRasterizers` | `256` | workgroups drawing the tiles (`1` to `1024`) |
| `hairVisibilityComputeRasterNumRasterizersNaive` | `256` | workgroups of the naive raster (`1` to `1024`) |
| `hairVisibilityNumClassifiers` | `32` | workgroups of the classification (`1` to `256`) |
| `hairVisibilityComputeRasterMaxTiles` | `65536` | most tiles kept, `1024` to `262144`; a tile holds 256 segments, and a device whose storage binding holds fewer takes the most it holds; segments past them are not drawn |

```js
// Strands drawn by the compute raster, its tiles compacted and its segments classified.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVisibilityComputeRaster: true,
  hairVisibilityTileCompaction: true,
  hairVisibilityClassification: true,
})
```
