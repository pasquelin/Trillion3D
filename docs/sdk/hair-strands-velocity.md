# Hair strands: velocity
`hairVelocityType` (`'closest'`) picks the velocity a pixel of strands writes over the surface's,
from the velocity of the strands' samples in that pixel: `'closest'` the nearest sample's,
`'average'` their mean, `'max'` the largest. `hairVisibilityWriteVelocityCoverageThreshold` (`0`,
from 0 to 1) is the share of the pixel the strands must cover to write one; at `0` every pixel with
strands does. `hairVelocityThreshold` (`1`, from 0 to 512) is the velocity, in the reference's pixel
unit (the screen's -1 to 1 span over twice the larger side of the image), above which any sample of
a pixel marks it to be resolved at once by the temporal pass: its history restarts, the pixel is
sharper and noisier and does not smear.

```js
// Strands that write the mean velocity of their samples, only where they cover half a pixel, and resolve at once from a velocity of 3.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVelocityType: 'average',
  hairVisibilityWriteVelocityCoverageThreshold: 0.5,
  hairVelocityThreshold: 3,
})
```

The surfaces the strands cover wholly are in the lighting channels of those strands (the union of
the channels of the pixel's samples), so a pass that reads a surface's channels finds the strands'.
