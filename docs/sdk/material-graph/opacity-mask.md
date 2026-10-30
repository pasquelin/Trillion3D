# Opacity mask

## The cutout

A graph that wires `opacityMask` makes a masked surface: a pixel is kept where `opacityMask` is not
below the clip value, cut otherwise, in every pass that decides what a surface covers: the
visibility rasters, the dicing of a displaced surface and the shadow maps (a leaf casts the shadow
of its shape). The clip value is the material's `opacityMaskClipValue` (any number: the output is
compared with it as it comes, 0 keeps every pixel whose output is not below 0, and a graph's output
is not held to a range), else its `alphaTest` where above 0 (a glTF material keeps its
`alphaCutoff`), else 0.3333. The mask is the opaque class's: a translucent surface
(`transparent: true`) reads `opacity`, never `opacityMask`.

## What a mask can read

A cutout is decided where only a texture coordinate exists: `texCoord(0)` (or the one set a mask
names; a mask that names two is refused), a texture read at it, the parameters, `time` and
`realTime`, with the footprint of the render pixel. A mask that reads the world position, the
camera or its vector, the normal or the vertex colour is refused: the engine names it once
(`material-graph-refused`) and the surface is drawn whole. A mask that reads `time` animates in the
images and in the shadows of the surfaces that move; the shadow of a static surface whose mask
animates is not drawn again (it keeps the shape it was cached with).

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

- **`opacityMaskClipValue`** (a number, absent by default): the value `opacityMask` is cut against.
  Absent: the material's `alphaTest` where above 0, else 0.3333. A material with a graph that wires
  no `opacityMask` ignores it.
- **`ditherOpacityMask`** (boolean, `false` by default): the cut is dithered. Each pixel adds
  `0.83 × noise − 0.5` to the mask (less the clip value) before the test, the noise the engine's
  blue noise read at the pixel and at the image's frame (the wall clock at sixty a second), so the
  temporal anti-aliasing averages the edge into a soft translucency instead of a hard staircase. It
  applies in every raster that cuts pixels (the hardware raster, the compute raster and the shadow
  maps' raster, as the camera's) to any masked material, a graph's mask or a plain `alphaTest`; the
  dicing of a displaced surface cuts at its vertices, never at a pixel, and keeps the hard test.
  Until the engine has loaded its blue noise the cut is hard. A still image keeps the dither it was
  drawn with.
