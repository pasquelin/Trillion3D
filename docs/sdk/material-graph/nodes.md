# Nodes

Where an input is not wired, a node uses its own constant (its default is in brackets).

| Group | Calls |
| --- | --- |
| Constants | `constant(x)` to `constant(x, y, z, w)`; `channel(wire, 'rgb' \| 'r' \| 'a'…)` picks an output of a node (a sample's rgb, r, g, b, a, rgba) |
| Parameters | `scalarParameter(name, 0)`, `vectorParameter(name, [0, 0, 0, 1])`, `textureParameter(name, texture)`; `g.set(name, value)` gives them values |
| Textures | `textureSample(texture, { uv, texture, mip, mipMode: 'none' \| 'level' \| 'bias', constCoordinate: 0, name })`, `textureObject(texture)` |
| Coordinates | `texCoord(index = 0, uTiling = 1, vTiling = 1)`, `time(period?, ignorePause = false)` (`period` 0 holds it still), `panner({ speed: [u, v], coordinate, time, fractionalPart })`, `rotator({ centerX: 0.5, centerY: 0.5, speed: 0.25, coordinate, time })` |
| World | `worldPosition(cameraRelative)`, `cameraPosition()`, `objectPosition()`, `vertexNormal()`, `pixelNormal()`, `cameraVector()` (the unit vector from the point to the camera), `vertexColor()` (rgb, r, g, b, a; refused until a pass carries the vertex colour), where the domain has them |
| Arithmetic | `add(a, b)` (0, 1), `subtract` (1, 1), `multiply` (0, 1), `divide` (1, 2), `power(base, exponent = 2)`, `abs`, `min` (0, 1), `max` (0, 1), `clamp(x, min = 0, max = 1, mode)`, `saturate`, `lerp(a, b, alpha)` (0, 1, 0.5), `oneMinus`, `frac`, `floor`, `ceil`, `round`, `sign`, `fmod(a, b)`, `sqrt`, `exp`, `exp2`, `log`, `log2(x)`, `log10(x)` |
| Waves | `sine(x, period = 1)`, `cosine(x, period = 1)`, `tangent(x, period = 1)`: `x` is in turns of `period` when it is above 0, in radians otherwise; `arctangent2(y, x)` |
| Vectors | `dot`, `cross` (float3), `normalize`, `length`, `appendVector(a, b)` (four components at most), `componentMask(x, 'rg')` |
| Choice | `if(a, b, greater, equal, less, threshold = 0.00001)`: `greater` where `a >= b`, `less` below, `equal` within the threshold when wired |
| Colour | `fresnel({ exponent = 5, baseReflectFraction = 0.04, normal })`, `desaturation(x, fraction?, luminance?)`, `contrast(x, amount = 1, pivot = 0.5)` |
| Noise | `noise({ position, filterWidth = 0, noiseFunction = 'simplex', scale = 1, quality = 1, turbulence = true, levels = 6, outputMin = -1, outputMax = 1, levelScale = 2, tiling = false, repeatSize = 512, relativeToCamera = false })` |

A number passed where a wire goes is that node's own constant: `g.multiply(tex, 2)` and
`g.lerp(a, b, 0.25)` need no constant node. A texture reads through the materials' colour atlas,
with its own wrap, filters, repeat, offset and rotation; `mipMode` `'level'` reads the level in
`mip` (0 is the full picture), `'bias'` adds `mip` to the level the footprint asks. A sample waits,
like a map, until its texture has joined the atlas.

- **Texture coordinates.** The first set is `texCoord(0)`. A set past the first (`texCoord(1)` to
  `texCoord(3)`) is read where the geometry carries it; on a translucent surface, the program that
  carries one set past the first (the lobed one) reads one: the lowest the graph names; the sets
  past it read the first. Sets 4 to 7 read the first set.
- **Footprints.** A texture read takes its footprint from the coordinate evaluated at the pixel
  beside and the pixel below, so a tiled or panned coordinate reads the level its own pixels ask. A
  read whose coordinate holds another read takes the other's footprint at the pixel itself: three
  reads a level. The tiles a texture needs are asked of the streamer as a map's are.
- **Time.** A graph that reads `time` keeps the image drawing, in the opaque resolve and in the
  transparent pass: a view that shows one is not held on its last image. The time is the page's
  clock in seconds, read once an image, the same for the surface, the translucent surface, the fog
  and the rasters. A graph that reads `time` is drawn again at each image in every domain (a
  surface, the transparent pass, a volume of the fog, a light function). The `time` node, and the
  panner and the rotator when no time is wired, read the world's time: the clock the world's clips
  and controllers run on and the automatic exposure adapts on, a pause of the loop counted as one
  bounded interval, so a paused world holds every graph still. With `ignorePause` the node reads the
  wall clock instead, which runs through a pause: for an effect that must keep moving. An engine
  with no world (a bench) reads the wall clock for both.
- **Noise.** `noise` adds `levels` (1 to 10) noises of `position` (the world position, repeated
  every 65536 metres, where nothing is wired), each `levelScale` times finer and `levelScale` times
  weaker than the one before, and brings the sum to `outputMin`..`outputMax`: with `turbulence` the
  levels add the absolute value of the noise; without it the sum of -1..1 noises is brought to
  0..1. `filterWidth` fades the levels finer than it away (a level's weight is multiplied by
  `saturate(1 - width)`, the width growing with the frequency). The functions, each run in the
  shader from the lattice's coordinates alone:
  - `'simplex'`: gradient noise on the tetrahedra of a skewed lattice;
  - `'gradient'`: a cubic lattice repeating every `repeatSize` cells, and every 128 whatever the size;
  - `'fastGradient'`: repeating every 15 cells;
  - `'gradientAlu'`, `'valueAlu'`: cubic lattices of hashed values, each repeating every
    `repeatSize` cells where `tiling` is true;
  - `'voronoi'`: the distance to the nearest of the points jittered in each cell, `quality` 1 to 4
    searching 8, 16, 27 and 32 cells, repeating with `tiling`.

  A position is read in the graph's units, metres: `noise({ scale: 0.01 })` is a noise whose
  features are 100 metres across.
- **Fresnel.** `fresnel` is `pow(1 - max(0, n · v), exponent) × (1 - base) + base`, `n` the pixel's
  normal (or the wire `normal`), `v` the unit vector to the camera (`cameraVector`); the power's base
  is held to at least 0.0001. `desaturation` takes a colour (or a scalar, repeated) towards
  `dot(colour, luminance)`, the luminance weights of the sRGB working space (0.2126, 0.7152, 0.0722)
  unless named: by `fraction`, or, with none wired, to the grey itself (a scalar).
- **Not read.** A front material, a surface thickness, the customized texture coordinates `0` to
  `7` and the packed material attributes are not offered (`displacement`, `pixelDepthOffset` and
  `shadingModel` are outputs: [Pixel depth offset and displacement](depth-and-displacement.md)). On a translucent surface the position of the
  object (`objectPosition`) reads zero and the pixel normal is the vertex normal.
- **`power`.** `power(base, exponent = 2)` raises each component of `base` to the exponent and gives
  zero for a base of at most 2.98e-8 (2^-25): a negative base, or one too small for a logarithm in
  single precision, gives 0, never a NaN (a large result still overflows, as in single precision).
  The exponent is read as the base is: a scalar is repeated for every component; a vector of the
  base's width works on each component (a float3 base by a float3 exponent takes each channel to its
  own power); over a scalar base a vector exponent gives its first component. A vector exponent of
  another width than a vector base is refused with `INVALID_MATERIAL`: "arithmetic between float3
  and float2 is undefined". An exponent of 1, an exponent of 0 and a base of 0 are written as no
  code.

```js
const albedo = g.channel(g.vectorParameter('albedo', [0.8, 0.5, 0.2, 1]), 'rgb')
g.output('baseColor', g.power(albedo, 2.2)) // one exponent for the three channels
g.output('emissive', g.power(albedo, g.constant(2.2, 1, 0.5))) // red, green and blue each by their own
g.power(albedo, g.constant(2, 3)) // refused: float3 against float2
```

Time examples:

```js
const g = material.graph('surface')
g.output('emissive', g.sine(g.time(), 2)) // the world's time: holds while the world is paused
g.output('baseColor', g.sine(g.time(undefined, true), 0.25)) // ignorePause: the wall clock, runs through a pause
g.output('opacity', g.sine(g.time(4), 1)) // a period of 4 s on the world's time
```
