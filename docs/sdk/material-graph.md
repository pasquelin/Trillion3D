# Material graph

A material can compute its outputs from a graph: nodes wired into the outputs its domain reads, compiled to the shader that evaluates them. `material.graph(domain)` makes an empty one; each call on it adds a node and gives back the wire of its output, and `output(name, wire)` plugs a wire into an output.

```js
import { material, light, Texture } from 'trillion3d'

const g = material.graph('lightFunction') // 'surface' | 'lightFunction' | 'volume'
const clouds = g.textureSample(new Texture(cloudImage), { uv: g.panner({ speed: [0.02, 0] }) })
const tint = g.vectorParameter('tint', [1, 0.9, 0.7, 1]) // named, given values with g.set
g.output('emissive', g.multiply(g.channel(clouds, 'rgb'), g.channel(tint, 'rgb')))

lamp.lightFunction = material.lightFunction({ graph: g }) // the light shines through moving clouds
g.set('tint', [1, 0.5, 0.2]) // the next image
```

A material wears a graph of its own domain (`material.lightFunction({ graph })`, `material.volume({ graph })`, any other member for `'surface'`); another domain is refused (`INVALID_MATERIAL`). The graph is heard like a texture: a write to it, to a texture it reads, or to a parameter (`g.set(name, value)`) repaints what wears it. `material.clone()` clones the graph, and a saved world stores it with the material and reads it back, except a graph that holds a texture, refused as a material that holds one is (`SCENE_NOT_SAVABLE`).

**Outputs by domain.** An output is cast to its type (a scalar is repeated, a longer vector is cut, a shorter one is filled with zeros) and takes its default where nothing is wired.

| Output                   | Type   | Default       | `surface`                                                                                                                                                                                                                                                                                                         | `lightFunction` | `volume`            |
| ------------------------ | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------- |
| `baseColor`              | float3 | 0, 0, 0       | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 | the albedo          |
| `metallic`               | float  | 0             | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `specular`               | float  | 0.5           | read (a lit surface): a dielectric reflects 0.08 × it at normal incidence                                                                                                                                                                                                                                         |                 |                     |
| `roughness`              | float  | 0.5           | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `emissive`               | float3 | 0, 0, 0       | read; an unlit surface shows it as its colour                                                                                                                                                                                                                                                                     | the colour      | the light given off |
| `opacity`                | float  | 1             | read when `transparent`                                                                                                                                                                                                                                                                                           |                 |                     |
| `opacityMask`            | float  | 1             | read: wired, it makes the surface a masked one, cut where the output is below the clip value (`opacityMaskClipValue`, 0.3333)                                                                                                                                                                                     |                 |                     |
| `normal`                 | float3 | 0, 0, 1       | read (a lit surface, tangent space)                                                                                                                                                                                                                                                                               |                 |                     |
| `ambientOcclusion`       | float  | 1             | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `subsurfaceColor`        | float3 | 1, 1, 1       | read (a lit, two-sided surface: its thin transmission)                                                                                                                                                                                                                                                            |                 | the extinction      |
| `anisotropy`             | float  | 0             | read (a lit surface): the stretch of the highlight, from -1 to 1; a negative one stretches it along the bitangent                                                                                                                                                                                                 |                 |                     |
| `tangent`                | float3 | 1, 0, 0       | read with `anisotropy`: the direction of the stretch, in tangent space                                                                                                                                                                                                                                            |                 |                     |
| `clearCoat`              | float  | 1             | read (a lit surface): the strength of a clear coat over the base; off where unwired (the surface has no coat)                                                                                                                                                                                                     |                 |                     |
| `clearCoatRoughness`     | float  | 0.1           | read with `clearCoat`                                                                                                                                                                                                                                                                                             |                 |                     |
| `refraction`             | float  | 1             | read (a translucent surface that transmits): its index of refraction, 1 bending nothing, 0 saying none (the material's own applies)                                                                                                                                                                               |                 |                     |
| `worldPositionOffset`    | float3 | 0, 0, 0       | read: moves the vertices of the surface (world space), see "World position offset"                                                                                                                                                                                                                                |                 |                     |
| `shadingModel`           | float  | 1             | read where the material says `shadingModel: 'fromMaterialExpression'` (a lit opaque or masked surface): the shading model of the pixel, by the reference's numbers (0 unlit, 1 default lit, 2 subsurface, 4 clear coat, 6 two-sided foliage, 8 cloth), see "Shading model per pixel"; unwired, the material's own |                 |                     |
| `cloth`                  | float  | 0             | read with `subsurfaceColor` (a lit opaque or masked surface): the amount of the cloth model, from 0 to 1, the fuzz colour being `subsurfaceColor`; see "Shading model per pixel"                                                                                                                                  |                 |                     |
| `pixelDepthOffset`       | float  | 0             | read: the distance, in metres along the camera vector, the pixel is pushed away from the camera in the depth the visibility raster writes (an opaque or masked surface) or in the depth its responsiveness mark is tested at (a translucent one), see "Pixel depth offset"                                        |                 |                     |
| `displacement`           | float  | 0.5           | read (an opaque or masked surface): the normalized height the tessellation pushes the surface's points by, see "Displacement"                                                                                                                                                                                     |                 |                     |
| `scatteringCoefficients` | float3 | 0, 0, 0       | read (a lit surface that is water): the scattering of the water's volume, per centimetre; wiring any of the four water outputs makes the surface single-layer water, see "Single-layer water"                                                                                                                     |                 |                     |
| `absorptionCoefficients` | float3 | 0, 0, 0       | read (water): the absorption of the water's volume, per centimetre                                                                                                                                                                                                                                                |                 |                     |
| `phaseG`                 | float  | 0             | read (water): the anisotropy of the scattering, from -1 (back) to 1 (forward)                                                                                                                                                                                                                                     |                 |                     |
| `colorScaleBehindWater`  | float3 | 1, 1, 1       | read (water): a colour multiplied into what is seen through the water, faded out over the first 50 cm of depth; caustics, for one                                                                                                                                                                                 |                 |                     |
| `transmittanceColor`     | float3 | 0.5, 0.5, 0.5 | read (a lit translucent surface that is thin translucent): the colour the background is multiplied by for a view perpendicular to the surface, from 0 to 1; wiring it or `surfaceCoverage` makes the surface thin translucent, see "Thin translucent"                                                             |
| `surfaceCoverage`        | float  | 1             | read (thin translucent): the coverage of the whole surface, the thin part and the material over it, from 0 to 1                                                                                                                                                                                                   |

An output the domain does not read is refused when it is wired (`INVALID_MATERIAL`). A light function has no world position, camera, normal or depth: it is drawn once into an atlas slot for every light and view, so `worldPosition`, `cameraPosition`, `cameraVector`, `vertexNormal`, `pixelNormal` and `vertexColor` are refused there (`INVALID_MATERIAL`, naming the node), and `objectPosition` is zero. The volume domain has no normal. `pixelNormal` cannot feed `normal`.

A lobe is on where its output is wired (`anisotropy`, `clearCoat`); an unwired one is off, and the defaults above apply to the other output of its pair. A surface that wears a graph takes its lobes from the graph alone: the material's `anisotropy` and `clearcoat` are not read.

**Types.** A value is a float of one to four components (a texture object is a fifth kind, which only a sample reads). A scalar written as a constant fits any width. An operation between a scalar and a vector repeats the scalar; between two vectors of different widths it is an error ("arithmetic between float2 and float3 is undefined"). `min`, `max` and `clamp` make their other inputs the type of the first. Constants fold: the sum, product or sine of constants is a constant, a product by 0 or 1 and a quotient by 1 write no code, a `lerp` of equal values or at 0 or 1 is one of them, a quotient of constants is a constant. A value the pixels share — a constant, a parameter, anything computed from these alone — is known when the program is compiled, and some nodes treat it so: a divisor of that kind (`divide`, `fmod`) is held to at least 1e-5 in magnitude, its sign kept and a zero read as positive, so that `x / parameter` is `1e5 × x` where the parameter is 0 and a quotient of constants by 0 is a constant (a varying divisor is not held: a quotient by it is the hardware's); `normalize` of such a value leaves a zero vector at zero; `round` of it goes up at a half, where a varying value goes to the even whole number. `normalize` of a varying scalar is 1.

**Nodes.** Where an input is not wired, a node uses its own constant (its default is in brackets).

| Group       | Calls                                                                                                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constants   | `constant(x)` to `constant(x, y, z, w)`; `channel(wire, 'rgb' \| 'r' \| 'a'…)` picks an output of a node (a sample's rgb, r, g, b, a, rgba)                                                                                                                                                                                                         |
| Parameters  | `scalarParameter(name, 0)`, `vectorParameter(name, [0, 0, 0, 1])`, `textureParameter(name, texture)`; `g.set(name, value)` gives them values                                                                                                                                                                                                        |
| Textures    | `textureSample(texture, { uv, texture, mip, mipMode: 'none' \| 'level' \| 'bias', constCoordinate: 0, name })`, `textureObject(texture)`                                                                                                                                                                                                            |
| Coordinates | `texCoord(index = 0, uTiling = 1, vTiling = 1)`, `time(period?, ignorePause = false)` (`period` 0 holds it still), `panner({ speed: [u, v], coordinate, time, fractionalPart })`, `rotator({ centerX: 0.5, centerY: 0.5, speed: 0.25, coordinate, time })`                                                                                          |
| World       | `worldPosition(cameraRelative)`, `cameraPosition()`, `objectPosition()`, `vertexNormal()`, `pixelNormal()`, `cameraVector()` (the unit vector from the point to the camera), `vertexColor()` (rgb, r, g, b, a; refused until a pass carries the vertex colour), where the domain has them                                                           |
| Arithmetic  | `add(a, b)` (0, 1), `subtract` (1, 1), `multiply` (0, 1), `divide` (1, 2), `power(base, exponent = 2)`, `abs`, `min` (0, 1), `max` (0, 1), `clamp(x, min = 0, max = 1, mode)`, `saturate`, `lerp(a, b, alpha)` (0, 1, 0.5), `oneMinus`, `frac`, `floor`, `ceil`, `round`, `sign`, `fmod(a, b)`, `sqrt`, `exp`, `exp2`, `log`, `log2(x)`, `log10(x)` |
| Waves       | `sine(x, period = 1)`, `cosine(x, period = 1)`, `tangent(x, period = 1)`: `x` is in turns of `period` when it is above 0, in radians otherwise; `arctangent2(y, x)`                                                                                                                                                                                 |
| Vectors     | `dot`, `cross` (float3), `normalize`, `length`, `appendVector(a, b)` (four components at most), `componentMask(x, 'rg')`                                                                                                                                                                                                                            |
| Choice      | `if(a, b, greater, equal, less, threshold = 0.00001)`: `greater` where `a >= b`, `less` below, `equal` within the threshold when wired                                                                                                                                                                                                              |
| Colour      | `fresnel({ exponent = 5, baseReflectFraction = 0.04, normal })`, `desaturation(x, fraction?, luminance?)`, `contrast(x, amount = 1, pivot = 0.5)`                                                                                                                                                                                                   |
| Noise       | `noise({ position, filterWidth = 0, noiseFunction = 'simplex', scale = 1, quality = 1, turbulence = true, levels = 6, outputMin = -1, outputMax = 1, levelScale = 2, tiling = false, repeatSize = 512, relativeToCamera = false })`                                                                                                                 |

A number passed where a wire goes is that node's own constant: `g.multiply(tex, 2)` and `g.lerp(a, b, 0.25)` need no constant node. A texture reads through the materials' colour atlas, with its own wrap, filters, repeat, offset and rotation; `mipMode` `'level'` reads the level in `mip` (0 is the full picture), `'bias'` adds `mip` to the level the footprint asks. A sample waits, like a map, until its texture has joined the atlas.

**A surface that wears a graph is the graph.** The opaque resolve and the transparent pass read the outputs of the graph in place of the material's colour, `metalness`, `roughness`, `emissive`, normal map, occlusion map, lobes and thin transmission, and of its other maps; an output that is not wired takes its default (the table above), never the material's value. What the material still decides is how the surface is drawn: `side`, `transparent`, `blending`, `alphaTest`, `depthWrite`, its family (`meshStandard`, `meshPhysical`, `meshBasic`…) and its lit or unlit model. The outputs are held to their range as a shader holds them: `baseColor`, `metallic`, `roughness`, `ambientOcclusion`, `specular` and `opacity` from 0 to 1, `emissive` not below 0 (see `allowNegativeEmissive`), the thin transmission `subsurfaceColor` from 0 to 1. `normal` is in tangent space and bends the vertex normal in the frame the normal maps use; a surface has no `normal` map of its own while it wears a graph. The material's record holds neutral factors for such a surface, so its `opacity`, `subsurfaceColor` and maps leak into nothing.

**An unlit surface draws through `emissive`.** A material of an unlit family (`meshBasic`…) reads the `emissive` output as its colour, its `opacity`, its mask and its `worldPositionOffset`: its other outputs are not read and take their defaults, whatever is wired to them.

```js
import { material, Texture } from 'trillion3d'

// A glass that ripples: translucent, its colour and opacity from a panned map, its roughness from the time.
const g = material.graph('surface')
const waves = g.textureSample(new Texture(waveImage), {
  uv: g.panner({ speed: [0.03, 0.01], coordinate: g.texCoord(0, 4, 4) }),
})
g.output(
  'baseColor',
  g.multiply(g.channel(waves, 'rgb'), g.vectorParameter('tint', [0.6, 0.8, 1, 1])),
)
g.output('opacity', g.multiply(g.channel(waves, 'a'), 0.7))
g.output('roughness', g.add(0.1, g.multiply(g.sine(g.time(), 4), 0.05)))
g.output('specular', g.constant(0.9)) // a brighter highlight than the default 0.5 gives
mesh.material = material.meshStandard({ transparent: true, graph: g })
g.set('tint', [1, 0.7, 0.5]) // the next image: only a value is written, nothing compiles again
```

- **`allowNegativeEmissive`.** A material option, `false` by default: the `emissive` output may take light away only where it is `true`, as in `material.meshStandard({ allowNegativeEmissive: true, graph })`. It is saved with the world and is part of what decides the surface's program.
- **Specular.** A dielectric reflects `0.08 × specular` at normal incidence, `0.04` at the default 0.5, the value of every surface that gives none; a metal reflects its colour. The opaque resolve leaves the specular of a pixel in its surface flags (a step of 1/254), the lights, the reflections' weight and the transparent pass read it; a clear coat keeps its own 0.04 (`'layered'`), or adds `0.04 × its weight` to the reflectance (`'single'`).
- **Anisotropy.** The graph's `anisotropy` `a`, from -1 to 1 (`tangent` the direction of the stretch, in tangent space, carried whole to the world and kept orthogonal to the final normal), makes the highlight `α(1 + a)` wide along the tangent and `α(1 − a)` across it, `α` the square of the roughness; where `a` is negative the long axis is the bitangent. A material's own `anisotropy` gives the same widths. Under a clear coat the base keeps its anisotropy, in the coat's context.
- **Refraction.** The `refraction` output of a translucent surface that transmits (`meshPhysical({ transmission: 1, transparent: true })`) is the index of refraction its fragments bend what lies behind by; 1, the default, bends nothing, and 0 says none: the material's own applies. A graph that wires it wins over the `ior` the material declares. Of the reference's three refraction modes only the index of refraction is read; the pixel-normal strength, the two-dimensional offset and the refraction depth bias are not offered.
- **Texture coordinates.** The first set is `texCoord(0)`. A set past the first (`texCoord(1)` to `texCoord(3)`) is read where the geometry carries it; on a translucent surface, the program that carries one set past the first (the lobed one) reads one: the lowest the graph names; the sets past it read the first. Sets 4 to 7 read the first set.
- **Footprints.** A texture read takes its footprint from the coordinate evaluated at the pixel beside and the pixel below, so a tiled or panned coordinate reads the level its own pixels ask. A read whose coordinate holds another read takes the other's footprint at the pixel itself: three reads a level. The tiles a texture needs are asked of the streamer as a map's are.
- **Time.** A graph that reads `time` keeps the image drawing, in the opaque resolve and in the transparent pass: a view that shows one is not held on its last image. The time is the page's clock in seconds, read once an image, the same for the surface, the translucent surface, the fog and the rasters.
- **Noise.** `noise` adds `levels` (1 to 10) noises of `position` — the world position, repeated every 65536 metres, where nothing is wired —, each `levelScale` times finer and `levelScale` times weaker than the one before, and brings the sum to `outputMin`..`outputMax`: with `turbulence` the levels add the absolute value of the noise, without it the sum of -1..1 noises is brought to 0..1. `filterWidth` fades the levels finer than it away (a level's weight is multiplied by `saturate(1 - width)`, the width growing with the frequency). The functions are `'simplex'` (gradient noise on the tetrahedra of a skewed lattice), `'gradient'` (a cubic lattice repeating every `repeatSize` cells, and every 128 whatever the size), `'fastGradient'` (repeating every 15 cells), `'gradientAlu'`, `'valueAlu'` (cubic lattices of hashed values, each repeating every `repeatSize` cells where `tiling` is true) and `'voronoi'` (the distance to the nearest of the points jittered in each cell, `quality` 1 to 4 searching 8, 16, 27 and 32 cells, repeating with `tiling`); each runs in the shader, from the lattice's coordinates alone. A position is read in the graph's units, metres: `noise({ scale: 0.01 })` is a noise whose features are 100 metres across.
- **Fresnel.** `fresnel` is `pow(1 - max(0, n · v), exponent) × (1 - base) + base`, `n` the pixel's normal (or the wire `normal`), `v` the unit vector to the camera (`cameraVector`); the power's base is held to at least 0.0001. `desaturation` takes a colour (or a scalar, repeated) towards `dot(colour, luminance)`, the luminance weights of the sRGB working space (0.2126, 0.7152, 0.0722) unless named: by `fraction`, or, with none wired, to the grey itself (a scalar).
- **Not read.** The outputs that move a pixel or change a shading model — a displacement, a pixel depth offset, a shading model, a front material, a surface thickness, the customized texture coordinates `0` to `7` and the packed material attributes — are not offered: they need the programmable raster this engine does not have yet. On a translucent surface the position of the object (`objectPosition`) reads zero and the pixel normal is the vertex normal.
- **A graph the pass refuses** (a node or output it cannot compile) is named once (`material-graph-refused`) and the surface is drawn from the material's parameters. A scene wears at most 256 programs of the opaque resolve at once, each over its geometry's attributes (a program no surface wears gives its place back): past them a surface is drawn from its parameters and the engine says so.
- **A pipeline the device refuses to compile** is named once per pipeline (`pipeline-refused`, with the pipelines it names): the pass that needs it is left out of the image, which stays as drawn without it, and the engine asks the device again after a wait that starts at 4 seconds and doubles at each refusal in a row (up to about 4 minutes, each wait spread by a quarter either way), for a pipeline still in use; a refusal that cannot pass (the shader or its layout is wrong, the device was lost) is not tried again.
- **A graph that joins a running world** (a material assigned, a node, an output or a texture written into a graph a material wears) makes its surfaces wear another program. The engine compiles it while the frame waits, showing the previous image, and does not open the session again; the cutouts and offsets the rasters evaluate join the modules that hold them the same way, and the engine says so once (`material-graph-rasters-late`). A value written with `g.set` writes the values alone: nothing compiles. When an offset joins, the temporal anti-aliasing starts its history again.

**Opacity mask (the cutout).** A graph that wires `opacityMask` makes a masked surface: a pixel is kept where `opacityMask` is not below the clip value, cut otherwise, in every pass that decides what a surface covers — the visibility rasters, the dicing of a displaced surface and the shadow maps (a leaf casts the shadow of its shape). The clip value is the material's `opacityMaskClipValue` (any number: the output is compared with it as it comes, 0 keeps every pixel whose output is not below 0, and the output of a graph is not held to a range), else its `alphaTest` where above 0 (a glTF material keeps its `alphaCutoff`), else 0.3333. The mask is the opaque class's: a translucent surface (`transparent: true`) reads `opacity`, never `opacityMask`.

**What a mask can read.** A cutout is decided where only a texture coordinate exists: `texCoord(0)` (or the one set a mask names; a mask that names two is refused), a texture read at it, the parameters, `time` and `realTime`, with the footprint of the render pixel. A mask that reads the world position, the camera or its vector, the normal or the vertex colour is refused: the engine names it once (`material-graph-refused`) and the surface is drawn whole. A mask that reads `time` animates in the images and in the shadows of the surfaces that move; the shadow of a static surface whose mask animates is not drawn again (it keeps the shape it was cached with).

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

- **`opacityMaskClipValue`** (a number, absent by default): the value `opacityMask` is cut against. Absent: the material's `alphaTest` where above 0, else 0.3333. A material with a graph that wires no `opacityMask` ignores it.
- **`ditherOpacityMask`** (boolean, `false` by default): the cut is dithered. Each pixel adds `0.83 × noise − 0.5` to the mask (less the clip value) before the test, the noise the engine's blue noise read at the pixel and at the image's frame (the wall clock at sixty a second), so that the temporal anti-aliasing averages the edge into a soft translucency instead of a hard staircase. It applies in every raster that cuts pixels — the hardware raster, the compute raster and the shadow maps' raster, as the camera's — to any masked material, a graph's mask or a plain `alphaTest`; the dicing of a displaced surface cuts at its vertices, never at a pixel, and keeps the hard test. Until the engine has loaded its blue noise the cut is hard. A still image keeps the dither it was drawn with.
- **`normalCurvatureToRoughness`** (boolean, `false` by default): the material's roughness is raised to at least the one given by the change of its vertex normal across one pixel: `saturate(max(dN/dx·dN/dx, dN/dy·dN/dy)^0.333)`, so a curved surface far away reads rougher and its highlight does not flicker. It reads the interpolated vertex normal, never the normal map, and costs no extra texture read; a flat face is unchanged. A clear coat's roughness is raised the same way. The curve is set by the `world.shading` fields `normalCurvatureScale` (`1`, any number, held to [0, 2] where read), `normalCurvatureBias` (`0`, any number, held to [-1, 1] where read) and `normalCurvatureExponent` (`0.333`, any number, held to [0.05, 20] where read), each an option of `createWorld` too: `world.shading = { normalCurvatureExponent: 0.5 }`. Example: `new Material('meshStandard', { roughness: 0.2, normalCurvatureToRoughness: true })`.

**World position offset.** `g.output('worldPositionOffset', offset)` moves every vertex of the surface by `offset`, a float3 in the world's axes and metres, evaluated for each vertex in every pass that places it: the visibility buffer's two rasters, the shading of a pixel, the shadow maps (a swaying tree casts the shadow of the shape it has), the translucent pass and the temporal anti-aliasing (which reprojects a pixel by where its vertex was, so a moving surface leaves no trail). The offset sees what a vertex has: `worldPosition()` (the vertex before the offset), `objectPosition()`, `cameraPosition()`, `vertexNormal()`, `time()`, the parameters, **one** texture coordinate set (`texCoord(0)` is the geometry's first set; a vertex weight painted in the second coordinate of the UVs is a common use) and the textures it reads. It reads no `pixelNormal()` and no second texture set: a graph that wires such an offset is refused (named once, `material-graph-refused`) and its surface is drawn from the material's parameters, as any graph the engine does not compile. An offset that is not a finite number is not corrected: the vertex goes where the number says.

What moves: the triangles of a surface; the corners of the flat triangles of a surface displaced by a height map (`displacementMap`), which are moved before the patch is cut and diced, so the patch is diced and displaced on the moved triangle; the bricks of voxels the far levels of a mesh are drawn as (`voxelize`), each brick rigidly, by the offset at the centre of its box, its box and its voxels alike — a swaying crown does not stop where the cut switches to voxels. A sprite and a line are built on the screen and are not moved.

A texture read in the offset is read at the finest level (a vertex has no footprint) and asks no tile: a tile that is not resident reads its fallback level. A device lets its vertex stages read the colour atlas when it grants ten storage buffers a stage (`maxStorageBuffersPerShaderStage`, and `maxStorageBuffersInVertexStage` where it reports one); the engine asks the adapter for all it offers. On a device that grants fewer, a graph whose offset reads a texture is refused once (`material-graph-refused`) and its surface is not moved. The shadow maps' splitting of a displaced surface's patches judges them by the offsets that read no texture alone; the vertices drawn are moved by all.

```js
import { material, Mesh } from 'trillion3d'

// A leaf that bends in the wind: the farther up its UVs, the more it sways, along a direction that turns with the position.
const g = material.graph('surface')
g.output('baseColor', g.constant(0.2, 0.6, 0.2))
const height = g.componentMask(g.texCoord(0), 'g')
const phase = g.add(g.time(), g.componentMask(g.worldPosition(), 'r'))
const sway = g.multiply(g.multiply(g.sine(phase, 2), height), g.scalarParameter('amplitude', 0.15))
g.output('worldPositionOffset', g.multiply(sway, g.constant(1, 0, 0.4)))
const leaf = material.meshStandard({ graph: g, maxWorldPositionOffset: 0.2 })
const tree = new Mesh(geometry, leaf)
tree.worldPositionOffsetDisableDistance = 80 // past 80 m from the camera the leaves stop swaying
tree.shadowCacheInvalidation = 'rigid' // its shadows are not drawn again for the sway, only when it moves
tree.mobility = 'movable' // it arrives cached in the dynamic layer of the shadow maps, as one often moving does
scene.add(tree)
```

The object decides whether and how far its surfaces' offsets are evaluated (properties of the node, saved with the world, written in place; the defaults are the reference's):

- **`evaluateWorldPositionOffset`** (boolean, `true`): `false` leaves the object's vertices where the geometry puts them.
- **`worldPositionOffsetDisableDistance`** (metres, `0`): past this distance from the camera to the centre of the object's bounds the offset stops (0 never stops it). In the shadow maps of a directional light the distance is the clipmap level's: an object that names one is moved in the levels whose threshold distance — the distance past which the level no longer shows the motion, which doubles for each level coarser — is not past its own, and left at rest in the coarser ones; a local light's maps move it whatever the distance. A level's threshold counts the clipmap's whole resolution bias, the view's width and field of view included. Three settings of the shadow maps name the rule: `shadowClipmapWpoDisableDistance` (`true`; `false` moves the object in every level), `shadowClipmapWpoDisableDistanceLodBias` (3, from 0 to 30: the levels the rule is held back by) and `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` (`false`; `true` draws a level again when its threshold shifts with the view's resolution or field of view: steadier shadows of moving vegetation, at the price of redraw spikes).
- **`worldPositionOffsetWritesVelocity`** (boolean, `true`): whether the temporal anti-aliasing reprojects a pixel of the object by where its vertex was. `false` costs less where the offset does not change; with an offset that moves, it leaves a trail. The previous place is the offset of the image before — its clocks and camera — on the object where its previous world matrix put it.
- **`shadowCacheInvalidation`** (`'auto'`, `'always'`, `'rigid'` or `'static'`, `'auto'` by default): how the object's shadow pages are kept. `auto` draws them again while its offset is evaluated (not past its distance) or while it moves; `always` every image, for an animation the engine cannot know; `rigid` not for its offset, only when it moves; `static` not for its offset nor for its moves: a pose it takes later is not seen by its cached shadows, and the pages are drawn again when it joins or leaves the scene.
- **`mobility`** (`'static'`, `'stationary'` or `'movable'`, unset by default): whether the object is often moving. A `movable` object has its shadow pages kept in the dynamic layer of the shadow maps from the frame it joins the scene, so that its arrival draws no page of the static layer; the others are kept in the static layer until they first move. Either returns to the static layer after `shadowCacheFramesStaticThreshold` frames without a move. Unset, the object is `movable` when a skin or a morph deforms it and `static` otherwise; an object whose surfaces wear an offset or a displacement arrives in the dynamic layer whatever it says — unless the shadow option `shadowCacheWpoPrimitives` (false) is on —, and `shadowCacheInvalidation = 'static'` keeps it out of it. `undefined` gives back the default. It is saved with the world; a light keeps its own `mobility`, which is another setting.

Four more switches of the object say what it is to a view: **`firstPerson`** (boolean, `false`) marks an object drawn as a
first-person one — the hands and the weapon of a player, close to the camera: its pixels wear the first-person mark the shadows treat
apart (`shadowFirstPersonPixelRequestBias`, `shadowFirstPersonRequestMinLevelClamp`), and it casts no dynamic shadow of its own —,
**`firstPersonWorldSpaceRepresentation`** (boolean, `false`) marks the object that stands for it in the world, the body of the player:
the view that owns it, the main camera's, does not draw it (the reference forces `bOwnerNoSee` on it), and it casts into a second
clipmap of each sun (`shadowFirstPersonClipmap`, `docs/SHADOWS.md`) and into no regular shadow map; and **`castHiddenShadow`**
(boolean, `false`) lets an object that is hidden (`visible = false`, or under a hidden node) go on casting its shadow while no view
draws it (it is read for an object that casts and is no world-space representation); and **`holdout`** (boolean, `false`) cuts the object out of the picture: with `film.propagateAlpha` and `film.primitiveAlphaHoldout` on, its pixels are black with an alpha of 1 (nothing of the scene shows there, the image keeps the hole), and they leave no surface to the lighting, the reflections or the fog. With either film setting off, the flag is ignored. A node is a first-person object or its
world-space representation, never both: setting one while the other is on is refused (`RangeError`). All four are saved with the world.

```js
const arms = mesh(geometry, material)
arms.firstPerson = true
const body = mesh(geometry, material)
body.firstPersonWorldSpaceRepresentation = true // not drawn by the main camera, casts
const ghost = mesh(geometry, material)
ghost.castHiddenShadow = true
ghost.visible = false // casts, drawn by no view
const cutout = mesh(geometry, material)
cutout.holdout = true // a hole in the picture (film: propagateAlpha + primitiveAlphaHoldout)
```

**Who sees an object.** Two more switches, both `false` by default and saved with the world, hide an object by who looks. A camera
can name an **owner**, `camera.owner = node` (`null` by default): the node its view belongs to, the player's. An object that is the owner
or under it is _owned_ by that view. **`ownerNoSee`** hides the object from the views that own it and draws it for every other view;
**`onlyOwnerSee`** draws it for the views that own it alone and hides it from every other, those of cameras that name no owner
included. A camera with no owner owns nothing. The two switches add to a camera's `hidden` and `showOnly` lists, which still apply
(`hidden` wins). Until a camera names an owner, the stand-in of a first-person object (`firstPersonWorldSpaceRepresentation`) keeps
its own rule, hidden from the main camera; once one does, it is hidden from the views that own it, as an `ownerNoSee` object is.

```js
// The player's hands are seen by the player's camera alone, its body by every other camera.
const player = object.group()
player.add(hands, body)
hands.onlyOwnerSee = true
body.ownerNoSee = true
const eye = camera.perspective({ fov: 70 })
eye.owner = player // the player's own camera: it sees the hands, not the body
const minimap = camera.perspective()
minimap.owner = null // a camera that names no owner sees the body, not the hands
```

Two options of the material bound the offset: **`maxWorldPositionOffset`** (metres, `0`), the greatest distance the offset may move a vertex along an axis — the offset is held to it, and the bounds of the surface's clusters grow by it where the view and the shadows decide what is seen; `0` holds nothing and grows nothing, so an offset that moves a surface out of its bounds can be cut away at the edge of the view or of a shadow map before the surface reaches it: name the greatest offset when it is large —, and **`alwaysEvaluateWorldPositionOffset`** (boolean, `false`), which evaluates the offset whatever `evaluateWorldPositionOffset` and `worldPositionOffsetDisableDistance` say. The rays that light the scene's reflections and indirect light, and the distance fields, see the surface at rest.

**Shading model per pixel.** Where the material says `shadingModel: 'fromMaterialExpression'` (any other name, `defaultLit` by default, is the material's own and the graph's output is ignored), `g.output('shadingModel', model)` picks the shading model of each pixel of a lit surface the opaque or masked pass shades (a translucent surface shades by the material's). The value is the rounded number of the reference's own enumeration (`GRAPH_SHADING_MODELS`: `unlit` 0, `defaultLit` 1, `subsurface` 2, `preintegratedSkin` 3, `clearCoat` 4, `subsurfaceProfile` 5, `twoSidedFoliage` 6, `hair` 7, `cloth` 8, `eye` 9, `singleLayerWater` 10, `thinTranslucent` 11). The lighting has the physical model, the unlit one, the thin subsurface, the clear coat, the cloth, the preintegrated skin, the hair and the eye: a pixel of `unlit` shows its emission alone, as an unlit material does; a pixel of `twoSidedFoliage` reads `subsurfaceColor` as its thin transmission (a two-sided surface); one of `subsurface` is lit as `defaultLit` and, beside it, gets from every light a term of its own on any side: an in-scattering lobe against the eye, a wrapped back scattering weighed by the `opacity` output (read once a `shadingModel` is wired) and the material's occlusion, times the `subsurfaceColor` output (or its transmitted colour, hue-shifted, where the light is shadowed), which also adds to its indirect diffuse colour; one of `clearCoat` has the coat `clearCoat` and `clearCoatRoughness` give; one of `cloth` has the cloth lobe, its fuzz colour the `subsurfaceColor` output and its amount the `cloth` output (the cloth takes the place of the coat and the anisotropy); one of `preintegratedSkin` is lit as `defaultLit` and, beside it, lets light through its thickness: the light's cosine mapped to [0, 1] and one minus the `opacity` output (read for an opaque surface once a `shadingModel` is wired) address a table the reference ships (the `PreintegratedSkinBRDF` image, read from a file beside the module), times the `subsurfaceColor` output, which also adds to its indirect diffuse colour; one of `hair` has neither diffuse nor specular lobe but the hair's own scattering (reflection, transmission, internal reflection and a multiple scattering approximation): the `normal` output is the fibre's direction (toward its root), `roughness` and `specular` shape the lobes and `metallic` is the scatter amount; a hair reflects nothing and its indirect diffuse colour is its response to the environment; one of `eye` has the specular lobe of a dielectric and, in place of the diffuse lobe, a term that lights the sclera by the light's cosine and the iris by the cosine of its normal with a caustic, mixed by the iris mask: the mask and the distance of the iris are the `clearCoat` and `clearCoatRoughness` outputs, the iris direction the `tangent` output as a direction in the world's axes (where it is not wired the iris looks along `(0, 0, -1)`, the reference's own decoded default), and the metalness is not read. With `world.shading = { irisNormal: true }` (default `false`, the reference's `r.IrisNormal`) the iris has a normal of its own: the `clearCoatBottomNormal` output (a float3 in tangent space like `normal`, the iris plane normal — the `tangent` output, or the surface's normal where it is not wired — where it is not wired) is the iris normal, the caustic normal is the plane normal bent toward the opposite of the normal by the iris mask times the `clearCoatRoughness` output, and the eye's specular is held at 0.25. A pixel of `subsurfaceProfile` is lit as `defaultLit` with the Burley diffuse and two specular lobes, then scattered (see "The scattering of the light under a surface"); its `opacity` output (at 0.1 or under, the pixel is plain) is the share of the profile's radius it scatters over. A pixel of any other model is lit as `defaultLit`. A graph that wires no `shadingModel` keeps the behaviour of its wired outputs (a coat where `clearCoat` is wired, a cloth where `cloth` is wired and no model is, a thin transmission where only `subsurfaceColor` is).

```js
// A skin: opaque, lit by the preintegrated skin model, a little translucent (opacity 0.6) and tinted red where light goes through.
const g = material.graph('surface')
g.output('baseColor', g.constant(0.8, 0.6, 0.5))
g.output('roughness', g.constant(0.45))
material.shadingModel = 'fromMaterialExpression' // the graph's output decides
g.output('shadingModel', g.constant(3)) // preintegratedSkin; hair is 7, eye is 9
g.output('subsurfaceColor', g.constant(0.9, 0.3, 0.2))
g.output('opacity', g.constant(0.6))
```

```js
import { material } from 'trillion3d'

// A fabric with a worn patch: the cloth model where the mask is low, the plain lit one elsewhere.
const g = material.graph('surface')
const wear = g.channel(g.textureSample(wearMap), 'r') // wearMap: a Texture
g.output('baseColor', g.constant(0.4, 0.1, 0.1))
g.output(
  'shadingModel',
  g.if({ a: wear, constB: 0.5, aGreaterThanB: g.constant(1), aLessThanB: g.constant(8) }),
)
g.output('subsurfaceColor', g.constant(0.9, 0.6, 0.6)) // the fuzz colour of the cloth pixels
g.output('cloth', g.constant(0.8))
```

**Pixel depth offset.** `g.output('pixelDepthOffset', offset)` pushes each pixel of the surface away from the camera, by `offset` in metres along the camera vector, in the depth the visibility raster writes: the offset times the cosine of the pixel's ray with the view axis is added to the view depth, and a pixel is never brought nearer (a negative offset leaves it). It is how a decal-like layer sinks into a wall, or a plane of foliage is given thickness. It is evaluated by the software raster's pixels and the hardware raster's fragments of the rows that wire it, in the context a cutout has — its first texture coordinate set, its footprint and the clocks; a graph that reads a world position, the camera, a normal, a vertex colour or two texture sets there, or names another set than the `opacityMask`'s or the `worldPositionOffset`'s, is refused (named once, `material-graph-refused`) and the surface is written at the depth of its triangles. The shadow maps and the tessellated surfaces write the depth of their triangles whatever the output says, as the reference does. A translucent surface is drawn at the depth of its triangles whatever the output says; the output moves it only in the mark the layer leaves in the temporal pass's responsiveness (see "Thin translucent").

```js
const g = material.graph('surface')
g.output('baseColor', g.constant(0.5, 0.5, 0.5))
// A bump of 5 cm at the middle of each tile of the texture coordinate, seen as depth.
g.output(
  'pixelDepthOffset',
  g.multiply(g.channel(g.textureSample(heightMap), 'r'), g.constant(0.05)),
)
```

**Thin translucent.** A lit translucent surface whose graph wires `transmittanceColor` or `surfaceCoverage` is a thin translucent surface, the reference's thin translucent shading model (number 11 of `GRAPH_SHADING_MODELS`): an infinitely thin sheet that absorbs the background behind it, under a lit layer. The `opacity` output is the coverage of the lit layer (base colour and emission) over the sheet, `surfaceCoverage` the coverage of the whole, and `transmittanceColor` the colour the background keeps for a view perpendicular to the surface; the colour is taken to the power one over the cosine of the view with the normal, which makes the sheet thicker at a slant. The light entering and leaving the sheet is reduced by Fresnel (on the surface's specular colour, which follows `baseColor`, `metallic` and `specular`), and the specular of the lights and of the reflections is added over it. Both outputs are read in [0, 1]. Where the device is granted `dual-source-blending` the layer adds its light and multiplies the background by its transmittance in one pass; without it, the layer is blended by the grey coverage of that multiplier (its premultiplied colour, one minus the average of the multiplier as alpha). Like the reference's, the surface is lit per pixel, has the physical lighting only (a pixel naming model 11 in an opaque surface is lit as `defaultLit`), and marks the temporal pass's responsiveness as if its opacity were one. A glTF material with `KHR_materials_transmission` is such a surface, as the reference imports it: the transmittance colour is the base colour times the transmission, the lit layer covers by the largest of one minus the transmission, the metalness and the roughness, and the coverage is one; a material whose alpha mode is `mask` is clear (covers nothing, transmits all, has no specular) where its base map's alpha reaches 0.333 and glass elsewhere (it is not cut by its cutoff).

```js
import { material } from 'trillion3d'

// A tinted pane: the background keeps 20% of its red, 50% of its green and 90% of its blue seen straight on,
// the pane itself, a faint white, covers a tenth.
const g = material.graph('surface')
g.output('baseColor', g.constant(1, 1, 1))
g.output('roughness', g.constant(0.05))
g.output('opacity', g.constant(0.1))
g.output('transmittanceColor', g.constant(0.2, 0.5, 0.9))
g.output('surfaceCoverage', g.constant(1))
const pane = material.meshPhysical({ graph: g, transparent: true })
```

A graph that also wires `pixelDepthOffset` on a translucent surface moves the depth its responsiveness mark is tested at: the temporal pass's responsiveness is written by a pass of its own, on every device, which draws the translucent layers again into the responsive target, tested against the opaque depth at the depth the offset moves each pixel to, so a layer pushed behind the opaque surface leaves no mark. The colour passes write no mark.

**Displacement.** `g.output('displacement', height)` gives the normalized height, from 0 to 1, the tessellation pushes the points of the surface by along their normals, where a displaced glTF material reads its height map: a point moves by `(height - displacementCenter) * displacementMagnitude` metres, faded with distance. The material names the numbers, as the reference's material does: **`displacementMagnitude`** (metres, `4`), **`displacementCenter`** (`0.5`, the height that stays on the surface), and **`displacementFadeStart`** and **`displacementFadeEnd`** (the on-screen size in pixels of the largest displacement at which it starts to fade and is gone, the first the larger; both left out, it never fades). The output is read at the context of a cutout, one texture coordinate set (the texture coordinate density of the surface being measured for the glTF materials of a prepared scene, one unit of the set is a metre here), by the dicing of the image and of the shadow maps alike, so the shadow is that of the displaced surface. It follows the project's `tessellation` settings. A graph that reads more than that is refused as the pixel depth offset is, and the surface is drawn flat. The reference's `TessellationMultiplier` output is deprecated there and read by no shader, and is not an output here.

```js
const rock = material.graph('surface')
rock.output('baseColor', rock.constant(0.35, 0.33, 0.3))
rock.output('displacement', rock.channel(rock.textureSample(rockHeight), 'r'))
const stone = material.meshStandard({
  graph: rock,
  displacementMagnitude: 0.3,
  displacementCenter: 0.5,
})
```

**A graph in the volume domain.** An object of the fog's volume (a mesh that wears `material.volume({ graph })`, or `addFogVolume({ id, graph })`) takes its albedo from `baseColor` (from 0 to 1), its extinction from the red channel of `subsurfaceColor` (from 0 to 65 000 per metre) and its emissive light from `emissive`, evaluated at the centre of each cell it covers, in place of its `albedo`, `extinction` and `emissive`. Its context is the world position of the cell, the camera, the object's position and the time; there is no texture coordinate and no normal. The volume domain has no `ambientOcclusion` output: wiring it is refused. An unwired `subsurfaceColor` is 1: wire it, or the object adds one per metre.

```js
import { material, Texture } from 'trillion3d'

// Smoke that thins with height and drifts: a density from a noise map read at the world position.
const g = material.graph('volume')
const noise = g.textureSample(new Texture(noiseImage), {
  uv: g.panner({ speed: [0.02, 0], coordinate: g.componentMask(g.worldPosition(), 'rg') }),
})
const density = g.multiply(g.channel(noise, 'r'), g.scalarParameter('density', 0.8))
g.output('baseColor', g.constant(0.7, 0.7, 0.75))
g.output('subsurfaceColor', g.appendVector(density, g.constant(0, 0)))
g.output('emissive', g.constant(0, 0, 0))
scene.add(new Mesh(box, material.volume({ graph: g })))
```

A texture a volume graph reads is taken into the colour atlas and asked at its full detail: keep them small (a noise of 128 to 512 texels). A graph that does not compile adds what its material gives.

**A light function material on a mesh.** `material.lightFunction()` draws into the light function atlas alone. A mesh that wears one is drawn with the default material (white, unlit): it raises no error.

A graph that does not compile (a missing required input, a type error, a node the domain has no value for) raises `INVALID_MATERIAL` naming the node. A light function whose graph is refused is drawn from its parameters, as one with no graph is, and the engine names the refusal once (`light-function-graph-refused`). A graph that reads `time` is drawn again at each image, in every domain (a surface, the transparent pass, a volume of the fog, a light function). The `time` node, and the panner and the rotator when no time is wired, read the world's time: the clock the world's clips and controllers run on, the one the automatic exposure adapts on, a pause of the loop counted as one bounded interval, so that a paused world holds every graph still. With `ignorePause` the node reads the wall clock instead, which runs on through a pause: for an effect that must keep moving. The clock is read once for each image, so the surface, the transparent pass, the fog and a light function of one image read the same seconds. An engine with no world (a bench) reads the wall clock for both.

```js
const g = material.graph('surface')
g.output('emissive', g.sine(g.time(), 2)) // the world's time: holds while the world is paused
g.output('baseColor', g.sine(g.time(undefined, true), 0.25)) // ignorePause: the wall clock, runs through a pause
g.output('opacity', g.sine(g.time(4), 1)) // a period of 4 s on the world's time
```

`power(base, exponent = 2)` raises each component of `base` to the exponent and gives zero for a base of at most 2.98e-8 (2^-25): a negative base, or one too small to take a logarithm of in single precision, gives 0, never a NaN (a large result still overflows, as a single-precision power does). The exponent is read as the base is: a scalar is repeated for every component, a vector of the base's width works on each component of the base (a float3 base by a float3 exponent takes each channel to its own power), and over a scalar base a vector exponent gives its first component. A vector exponent of another width than a vector base is refused with `INVALID_MATERIAL`: "arithmetic between float3 and float2 is undefined". An exponent of 1, an exponent of 0 and a base of 0 are written as no code.

```js
const albedo = g.channel(g.vectorParameter('albedo', [0.8, 0.5, 0.2, 1]), 'rgb')
g.output('baseColor', g.power(albedo, 2.2)) // one exponent for the three channels
g.output('emissive', g.power(albedo, g.constant(2.2, 1, 0.5))) // red, green and blue each by their own
g.power(albedo, g.constant(2, 3)) // refused: float3 against float2
```
