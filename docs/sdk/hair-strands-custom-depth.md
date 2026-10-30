# Hair strands: custom depth
`hairRenderCustomDepth` (`false`) makes the strands render custom depth: for each pixel with strands, the depth of its first sample is written into a depth target of the view (`gpu.hair.customDepth.view`), which is 0 (reverse-Z, no strand) elsewhere. `hairCustomDepthCoverageThreshold` (`0`, from 0 to 1) is the share of the pixel the strands must cover to write it; at `0` every pixel with strands does, a higher value draws a finer outline.

```js
// Strands that write their custom depth where they cover at least a quarter of a pixel.
const world = createWorld('viewer', {
  hairStrands: true,
  hairRenderCustomDepth: true,
  hairCustomDepthCoverageThreshold: 0.25,
})
```
