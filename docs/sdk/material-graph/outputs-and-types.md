# Outputs and types

## Outputs by domain

An output is cast to its type (a scalar is repeated, a longer vector cut, a shorter one filled with
zeros) and takes its default where nothing is wired.

| Output | Type | Default | `surface` | `lightFunction` | `volume` |
| --- | --- | --- | --- | --- | --- |
| `baseColor` | float3 | 0, 0, 0 | read (a lit surface) | | the albedo |
| `metallic` | float | 0 | read (a lit surface) | | |
| `specular` | float | 0.5 | read (a lit surface): a dielectric reflects 0.08 × it at normal incidence | | |
| `roughness` | float | 0.5 | read (a lit surface) | | |
| `emissive` | float3 | 0, 0, 0 | read; an unlit surface shows it as its colour | the colour | the light given off |
| `opacity` | float | 1 | read when `transparent` | | |
| `opacityMask` | float | 1 | read: wired, it makes the surface a masked one, cut where the output is below the clip value (`opacityMaskClipValue`, 0.3333) | | |
| `normal` | float3 | 0, 0, 1 | read (a lit surface, tangent space) | | |
| `ambientOcclusion` | float | 1 | read (a lit surface) | | |
| `subsurfaceColor` | float3 | 1, 1, 1 | read (a lit, two-sided surface: its thin transmission) | | the extinction |
| `anisotropy` | float | 0 | read (a lit surface): the stretch of the highlight, from -1 to 1; a negative one stretches it along the bitangent | | |
| `tangent` | float3 | 1, 0, 0 | read with `anisotropy`: the direction of the stretch, in tangent space | | |
| `clearCoat` | float | 1 | read (a lit surface): the strength of a clear coat over the base; off where unwired (no coat) | | |
| `clearCoatRoughness` | float | 0.1 | read with `clearCoat` | | |
| `refraction` | float | 1 | read (a translucent surface that transmits): its index of refraction, 1 bending nothing, 0 saying none (the material's own applies) | | |
| `worldPositionOffset` | float3 | 0, 0, 0 | read: moves the vertices of the surface (world space), see "World position offset" | | |
| `shadingModel` | float | 1 | read where the material says `shadingModel: 'fromMaterialExpression'` (a lit opaque or masked surface): the pixel's shading model, by the reference's numbers (0 unlit, 1 default lit, 2 subsurface, 4 clear coat, 6 two-sided foliage, 8 cloth), see "Shading model per pixel"; unwired, the material's own | | |
| `cloth` | float | 0 | read with `subsurfaceColor` (a lit opaque or masked surface): the amount of the cloth model, 0 to 1, the fuzz colour being `subsurfaceColor`; see "Shading model per pixel" | | |
| `pixelDepthOffset` | float | 0 | read: the distance, in metres along the camera vector, the pixel is pushed away from the camera in the depth the visibility raster writes (an opaque or masked surface) or in the depth its responsiveness mark is tested at (a translucent one), see "Pixel depth offset" | | |
| `displacement` | float | 0.5 | read (an opaque or masked surface): the normalized height the tessellation pushes the surface's points by, see "Displacement" | | |
| `scatteringCoefficients` | float3 | 0, 0, 0 | read (a lit surface that is water): the scattering of the water's volume, per centimetre; wiring any of the four water outputs makes the surface single-layer water, see "Single-layer water" | | |
| `absorptionCoefficients` | float3 | 0, 0, 0 | read (water): the absorption of the water's volume, per centimetre | | |
| `phaseG` | float | 0 | read (water): the anisotropy of the scattering, from -1 (back) to 1 (forward) | | |
| `colorScaleBehindWater` | float3 | 1, 1, 1 | read (water): a colour multiplied into what is seen through the water, faded out over the first 50 cm of depth; caustics, for one | | |
| `transmittanceColor` | float3 | 0.5, 0.5, 0.5 | read (a lit translucent surface that is thin translucent): the colour the background is multiplied by for a view perpendicular to the surface, 0 to 1; wiring it or `surfaceCoverage` makes the surface thin translucent, see "Thin translucent" | | |
| `surfaceCoverage` | float | 1 | read (thin translucent): the coverage of the whole surface, the thin part and the material over it, 0 to 1 | | |

An output the domain does not read is refused when wired (`INVALID_MATERIAL`). A light function has
no world position, camera, normal or depth: it is drawn once into an atlas slot for every light and
view. So `worldPosition`, `cameraPosition`, `cameraVector`, `vertexNormal`, `pixelNormal` and
`vertexColor` are refused there (`INVALID_MATERIAL`, naming the node), and `objectPosition` is zero.
The volume domain has no normal. `pixelNormal` cannot feed `normal`.

A lobe is on where its output is wired (`anisotropy`, `clearCoat`); an unwired one is off, and the
defaults above apply to the other output of its pair. A surface that wears a graph takes its lobes
from the graph alone: the material's `anisotropy` and `clearcoat` are not read.

## Types

A value is a float of one to four components (a texture object is a fifth kind, which only a sample
reads). A scalar constant fits any width. An operation between a scalar and a vector repeats the
scalar; between two vectors of different widths it is an error ("arithmetic between float2 and
float3 is undefined"). `min`, `max` and `clamp` give their other inputs the type of the first.

Constants fold: the sum, product, sine or quotient of constants is a constant; a product by 0 or 1
and a quotient by 1 write no code; a `lerp` of equal values or at 0 or 1 is one of them. A value
the pixels share (a constant, a parameter, anything computed from these alone) is known when the
program is compiled, and some nodes use that:

- a divisor of that kind (`divide`, `fmod`) is held to at least 1e-5 in magnitude, sign kept, a zero
  read as positive: `x / parameter` is `1e5 × x` where the parameter is 0, and a quotient of
  constants by 0 is a constant (a varying divisor is not held: its quotient is the hardware's);
- `normalize` of such a value leaves a zero vector at zero;
- `round` of it goes up at a half, where a varying value goes to the even whole number.

`normalize` of a varying scalar is 1.
