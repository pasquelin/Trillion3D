# Opacity mask

## The cutout

A graph wiring `opacityMask` makes a masked surface: a pixel is kept where `opacityMask` is not below
the clip value, cut otherwise, in every pass deciding what a surface covers: the visibility rasters,
the dicing of a displaced surface and the shadow maps (a leaf casts its shape's shadow). The clip
value is the material's `opacityMaskClipValue` (any number: the output is compared as it comes, 0
keeps every pixel whose output is not below 0, no range is enforced), else its `alphaTest` where above
0 (a glTF material keeps its `alphaCutoff`), else 0.3333. The mask is the opaque class's: a
translucent surface (`transparent: true`) reads `opacity`, never `opacityMask`.

## What a mask can read

A cutout is decided where only a texture coordinate exists: `texCoord(0)` (or the one set a mask
names; a mask naming two is refused), a texture read at it, the parameters, `time` and `realTime`,
with the render pixel's footprint. A mask reading the world position, the camera or its vector, the
normal or the vertex colour is refused: named once (`material-graph-refused`) and the surface is
drawn whole. A mask reading `time` animates in the images and in the shadows of moving surfaces; the
shadow of a static surface whose mask animates is not redrawn (it keeps the cached shape).

```js
import { material, Texture } from 'trillion3d'

// A leaf that dissolves: the alpha of its map, eaten by a noise that drifts with the time.
const g = material.graph('surface')
const leaf = g.textureSample(new Texture(leafImage), { uv: g.texCoord(0) })
const eaten = g.textureSample(new Texture(noiseImage), {
  uv: g.panner({ speed: [0.05, 0], coordinate: g.texCoord(0, 3, 3) }),
})
g.output('baseColor', g.channel(leaf, 'rgb'))
g.output('opacityMask', g.multiply(g.channel(leaf, 'a'), g.add(g.channel(eaten, 'r'), 0.2)))
const wear = material.meshStandard({ graph: g, side: 'double', opacityMaskClipValue: 0.5 })
```

Two material options (saved with the world, written in place):

- **`opacityMaskClipValue`** (number, absent by default): the value `opacityMask` is cut against.
  Absent: the material's `alphaTest` where above 0, else 0.3333. Ignored by a graph wiring no
  `opacityMask`.
- **`ditherOpacityMask`** (boolean, `false`): the cut is dithered. Each pixel adds
  `0.83 × noise − 0.5` to the mask (less the clip value) before the test, the noise the engine's blue
  noise read at the pixel and the image's frame (wall clock at sixty a second), so temporal
  anti-aliasing averages the edge into soft translucency instead of a hard staircase. Applies in
  every raster that cuts pixels (hardware, compute, and the shadow maps' raster, as the camera's) to
  any masked material, a graph's mask or a plain `alphaTest`; the dicing of a displaced surface cuts
  at its vertices, never at a pixel, and keeps the hard test. Until the blue noise has loaded the cut
  is hard. A still image keeps the dither it was drawn with.
