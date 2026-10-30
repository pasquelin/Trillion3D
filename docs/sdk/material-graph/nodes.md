# Nodes

Unwired inputs use the node's constant (default in brackets).

| Group | Calls |
| - | - |
| Constants | `constant(x)` to `constant(x, y, z, w)`; `channel(wire, 'rgb' \| 'r' \| 'a'…)` picks an output (sample: rgb, r, g, b, a, rgba) |
| Parameters | `scalarParameter(name, 0)`, `vectorParameter(name, [0, 0, 0, 1])`, `textureParameter(name, texture)`; `g.set(name, value)` |
| Textures | `textureSample(texture, { uv, texture, mip, mipMode: 'none' \| 'level' \| 'bias', constCoordinate: 0, name })`, `textureObject(texture)` |
| Coordinates | `texCoord(index = 0, uTiling = 1, vTiling = 1)`, `time(period?, ignorePause = false)` (`period` 0 holds it still), `panner({ speed: [u, v], coordinate, time, fractionalPart })`, `rotator({ centerX: 0.5, centerY: 0.5, speed: 0.25, coordinate, time })` |
| World | `worldPosition(cameraRelative)`, `cameraPosition()`, `objectPosition()`, `vertexNormal()`, `pixelNormal()`, `cameraVector()` (unit, to camera), `vertexColor()` (rgb, r, g, b, a; refused until a pass carries it) |
| Arithmetic | `add(a, b)` (0, 1), `subtract` (1, 1), `multiply` (0, 1), `divide` (1, 2), `power(base, exponent = 2)`, `abs`, `min` (0, 1), `max` (0, 1), `clamp(x, min = 0, max = 1, mode)`, `saturate`, `lerp(a, b, alpha)` (0, 1, 0.5), `oneMinus`, `frac`, `floor`, `ceil`, `round`, `sign`, `fmod(a, b)`, `sqrt`, `exp`, `exp2`, `log`, `log2(x)`, `log10(x)` |
| Waves | `sine(x, period = 1)`, `cosine(x, period = 1)`, `tangent(x, period = 1)`: `x` in turns of `period` above 0, radians otherwise; `arctangent2(y, x)` |
| Vectors | `dot`, `cross` (float3), `normalize`, `length`, `appendVector(a, b)` (four components at most), `componentMask(x, 'rg')` |
| Choice | `if(a, b, greater, equal, less, threshold = 0.00001)`: `greater` where `a >= b`, `less` below, `equal` within threshold |
| Colour | `fresnel({ exponent = 5, baseReflectFraction = 0.04, normal })`, `desaturation(x, fraction?, luminance?)`, `contrast(x, amount = 1, pivot = 0.5)` |
| Noise | `noise({ position, filterWidth = 0, noiseFunction = 'simplex', scale = 1, quality = 1, turbulence = true, levels = 6, outputMin = -1, outputMax = 1, levelScale = 2, tiling = false, repeatSize = 512, relativeToCamera = false })` |

A number for a wire is that node's constant: `g.multiply(tex, 2)`, `g.lerp(a, b, 0.25)`.
`mipMode` `'level'` reads level `mip` (0 full size), `'bias'` adds `mip` to the footprint's level.

- **Footprints.** A read takes its footprint from its coordinate at the pixels beside and below; a
  read whose coordinate holds another read takes the other's footprint at the pixel itself.
- **Texture coordinates.** First set `texCoord(0)`; `texCoord(1)` to `texCoord(3)` read where the
  geometry has them; sets 4 to 7 read the first. Translucent lobed program: lowest set named.
- **Time.** `time`, and panner and rotator with no time wired, read the world's time (seconds, held
  while paused); `ignorePause` or no world (bench) reads the wall clock.
- **Noise.** `noise` adds `levels` (1 to 10) noises of `position` (world position, repeated every 65536 m,
  unwired), each `levelScale` times finer and weaker, brought to `outputMin`..`outputMax`
  (`turbulence` adds absolute values; otherwise the sum is brought to 0..1). `filterWidth` fades
  finer levels (weight × `saturate(1 - width)`). `noise({ scale: 0.01 })`: 100 m features.
  Functions:
  - `'simplex'`: default; `'gradient'`: repeats every `repeatSize` cells and every 128 whatever;
  - `'fastGradient'`: repeats every 15 cells;
  - `'gradientAlu'`, `'valueAlu'`: repeat every `repeatSize` where `tiling`;
  - `'voronoi'`: `quality` 1 to 4 searches 8, 16, 27, 32 cells, repeats with `tiling`.
- **Fresnel.** `fresnel` is `pow(1 - max(0, n · v), exponent) × (1 - base) + base`, `n` the pixel normal (or wire
  `normal`), `v` = `cameraVector`; the power's base is at least 0.0001. `desaturation` moves a
  colour towards `dot(colour, luminance)`, sRGB weights (0.2126, 0.7152, 0.0722), by `fraction`.
- **Not read.** Front material, surface thickness, customized texture coordinates `0` to `7`, packed material
  attributes (`displacement`, `pixelDepthOffset`, `shadingModel`: outputs,
  [Pixel depth offset and displacement](depth-and-displacement.md)). Translucent:
  `objectPosition` reads zero, pixel normal is the vertex normal.
- **`power`.** A `base` of at most 2.98e-8 (negative too) gives 0, never a NaN. A scalar exponent is
  repeated; a vector of the `base`'s width works per component; over a scalar one a vector exponent
  gives its first component; other widths: `INVALID_MATERIAL` ("arithmetic between float3 and
  float2 is undefined").

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
