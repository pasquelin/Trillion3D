# Outputs and types

## Outputs by domain

Outputs are cast to their type (scalar repeated, longer vector cut, shorter zero-filled).

| Output | Type | Default | Read by domain |
| - | - | - | - |
| `baseColor` | float3 | 0, 0, 0 | `surface` (lit); `volume`: albedo |
| `metallic` | float | 0 | `surface` (lit) |
| `specular` | float | 0.5 | `surface` (lit): dielectric reflects 0.08 × it at normal |
| `roughness` | float | 0.5 | `surface` (lit) |
| `emissive` | float3 | 0, 0, 0 | `surface` (unlit: colour); `lightFunction`: colour; `volume`: light |
| `opacity` | float | 1 | `surface` when `transparent` |
| `opacityMask` | float | 1 | `surface`: wired, makes it masked, cut below `opacityMaskClipValue` (0.3333) |
| `normal` | float3 | 0, 0, 1 | `surface` (lit, tangent space) |
| `ambientOcclusion` | float | 1 | `surface` (lit) |
| `subsurfaceColor` | float3 | 1, 1, 1 | `surface` (lit, two-sided: thin transmission); `volume`: extinction |
| `anisotropy` | float | 0 | `surface` (lit): -1 to 1; negative stretches along bitangent |
| `tangent` | float3 | 1, 0, 0 | `surface` with `anisotropy`: direction, tangent space |
| `clearCoat` | float | 1 | `surface` (lit): strength; none where unwired |
| `clearCoatRoughness` | float | 0.1 | `surface` with `clearCoat` |
| `refraction` | float | 1 | `surface` (translucent): index of refraction; 0 means the material's |
| `worldPositionOffset` | float3 | 0, 0, 0 | `surface`: moves vertices (world space), see "World position offset" |
| `shadingModel` | float | 1 | `surface` with material `shadingModel: 'fromMaterialExpression'` (lit opaque or masked): numbers 0 unlit, 1 default lit, 2 subsurface, 4 clear coat, 6 two-sided foliage, 8 cloth, see "Shading model per pixel" |
| `cloth` | float | 0 | `surface` (lit opaque or masked): amount 0 to 1, fuzz colour `subsurfaceColor` |
| `pixelDepthOffset` | float | 0 | `surface`: metres along the camera vector, away from it (visibility depth; translucent: responsiveness mark depth), see "Pixel depth offset" |
| `displacement` | float | 0.5 | `surface` (opaque, masked): normalized height, see "Displacement" |
| `scatteringCoefficients` | float3 | 0, 0, 0 | `surface` (lit water): per cm; any water output makes single-layer water, see "Single-layer water" |
| `absorptionCoefficients` | float3 | 0, 0, 0 | `surface` (water): per cm |
| `phaseG` | float | 0 | `surface` (water): -1 (back) to 1 (forward) |
| `colorScaleBehindWater` | float3 | 1, 1, 1 | `surface` (water): multiplies what is seen through, fades out over 50 cm |
| `transmittanceColor` | float3 | 0.5, 0.5, 0.5 | `surface` (thin translucent): background multiplier, 0 to 1; wiring it or `surfaceCoverage` makes thin translucent, see "Thin translucent" |
| `surfaceCoverage` | float | 1 | `surface` (thin translucent): 0 to 1 |

An output the domain does not read is refused when wired (`INVALID_MATERIAL`). A light function
refuses `worldPosition`, `cameraPosition`, `cameraVector`, `vertexNormal`, `pixelNormal` and
`vertexColor` (`INVALID_MATERIAL`, naming the node); `objectPosition` is zero. The volume domain has
no normal. `pixelNormal` cannot feed `normal`.

A lobe is on where its output is wired (`anisotropy`, `clearCoat`); the material's `anisotropy` and
`clearcoat` are ignored under a graph.

## Types

A value is a float of one to four components (a texture object is a fifth kind).
A scalar fits any width; vectors of different widths are an error ("arithmetic between float2 and
float3 is undefined"). `min`, `max`, `clamp` cast inputs to the first's type.

Constants fold; a product by 0 or 1, a quotient by 1 and a trivial `lerp` write no code. For a value
the pixels share (constant, parameter, anything computed from these):

- a divisor (`divide`, `fmod`) is held to at least 1e-5 in magnitude, sign kept, zero read as
  positive (`x / parameter` is `1e5 × x` at 0); not so for a varying divisor;
- `normalize` leaves a zero vector at zero;
- `round` goes up at a half (varying: to even).

`normalize` of a varying scalar is 1.
