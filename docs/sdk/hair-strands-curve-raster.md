# Hair strands: curve raster
`renderCurve` (`false`, experimental) runs the curve raster pipeline over the strands. The strands are cut into curves of at most 16 points, grouped by position into clusters of 64 curves; each image the pipeline keeps the instances and clusters that lie in the view and in front of the scene's depth (a furthest-depth pyramid of the scene), counts the visible clusters, cuts their curves into segments that it bins into tiles of 32 pixels by the depth of the scene in each tile (`renderCurveRasterNumBinners`, `32`, from 1 to 256, binners each with counts of their own), and compacts the segments of each tile into depth slices, at most 16 groups of 1024 segments, with a piece of raster work per tile. The device has no mesh shader, so only the software path exists: `renderCurveSwRaster` (`true`) runs it, and with it off nothing runs. The raster that draws the compacted segments is not there yet, so the pipeline draws nothing for now. `renderCurveRasterNumRasterizers` (`256`, from 1 to 1024) and `renderCurveRasterMinCoverage` (`0.05`, from 0 to 1, the coverage under which a raster step stops) are for that raster. Images wider than 8192 pixels skip the pipeline.

```js
// The curve raster with sixteen binners, on its software path.
const world = createWorld('viewer', {
  hairStrands: true,
  renderCurve: true,
  renderCurveSwRaster: true,
  renderCurveRasterNumBinners: 16,
})
```
