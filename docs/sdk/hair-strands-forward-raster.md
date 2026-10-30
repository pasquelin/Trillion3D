# Hair strands: forward raster

`hairVisibilityComputeRasterForward` (`false`) draws the strands without a visibility buffer. Every
control point of the strands in view becomes a sample lit once (the strands' material and lights run
over the points, not the pixels), then a tiled compute raster shades the segments between points
straight into the image: segments are cut to the view, binned in tiles of 32 pixels (only tiles in
front of the opaque depth), gathered and ordered by depth, and each tile of 8 pixels takes them
front to back, mixing the lit points' colours along each segment and stopping when its pixels are
covered. It takes the place of `hairVisibilityComputeRaster` when both are on, keeps no sample a
pixel (`hairVisibilitySamplesPerPixel`, `hairVisibilitySortByDepth`, `hairVisibilityCoverageMapping`
do not apply) and needs `hairStrands`. The strands keep the surfaces' velocity, and a point off the
image is lit as the nearest pixel of the edge. Its groups are the compute raster's own settings:

| Setting | Default | Meaning |
| - | - | - |
| `hairVisibilityComputeRasterNumBinners` | `32` | workgroups binning the segments into tiles, `1` to `256` |
| `hairVisibilityComputeRasterNumRasterizers` | `256` | workgroups shading the tiles, `1` to `1024` |
| `hairVisibilityComputeRasterMaxTiles` | `65536` | lists of 1024 segments kept, `1024` to `262144`; a device whose storage binding holds fewer takes the most it holds, segments past them are not drawn |

```js
// Strands drawn by the forward raster, with fewer, larger groups for a small image.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVisibilityComputeRasterForward: true,
  hairVisibilityComputeRasterNumBinners: 16,
  hairVisibilityComputeRasterNumRasterizers: 128,
})
```
