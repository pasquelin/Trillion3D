# Material surfaces

The visibility buffer is resolved into the material surfaces in compute, one indirect dispatch per
material class over that class's pixels (`materials/classes/materialPasses.ts`). The surfaces and
the feedback target are cleared first; then one compute pass sorts every pixel into its class's bin:
the shading bins (`materials/classes/shadeBins.ts`, `visibility/shader/shadeBinsWgsl.ts`,
`visibility/shader/shadeBinKernelsWgsl.ts`). The depth export writes each pixel's shading mask
(`r32uint`: bit 0 set, the bin from bit 4, the bin's quad mode at bit 18;
`visibility/raster/exportWgsl.ts`), the only thing the kernels read. A tile with no pixel of any bin
leaves before any vote; a mode no bin holds has no pass. Three steps (subgroup
operations where subgroups are the 64-lane workgroup, else workgroup barriers): a count (workgroup a
16 × 16 tile, lane a 2 × 2 quad along the Z-order, the tile's bins voted greatest first, one counter
add a tile and a bin); a reservation of each bin's range and dispatch; a scatter of each element
into its bin's range (the sixteen lanes of an 8 × 8 square all of the voted bin's make a full
64-pixel tile written from the range's start, other elements go loose from its end, in lane order).

A bin holds pixels (one word: coordinates and write mask) or quads (two words: top-left pixel and a
nibble a pixel): a class whose shading reads a neighbour's derivative is binned by quad, any other
by pixel. Gradients are the triangle's own, analytic (`uvGradients`, from the steps of
`pixelBarycentric`), so bins hold pixels unless `shadeBinningMode` forces quads; a quad's lane on a
pixel of another class does nothing (`shadesPixel`). Each class the resident clusters wear
(`PresentClasses`) shades its bin (`shade_cs`, `visibility/shader/shadeEntryWgsl.ts`) and stores its
pixels (`storeSurface`, `visibility/shader/shadeOutputsWgsl.ts`), decoding each pixel's own triangle
from its identifier (`visibility/shader/pixelTriangleWgsl.ts`). The bins' head and elements are two
`r32uint` record tables; each bin's count, first word and mode are one `vec4u` of a read-only
storage buffer.

The surfaces are two layered targets (`materials/surface/surfaceAllocation.ts`): the colours,
`rgba16float` (base colour and metalness, normal and roughness, the emission and occlusion while a
surface of the image can mark it, the thin transmission while a sheet transmits), and the words,
`r32uint` (the flags). A class stores every layer through two storage bindings, the feedback and
lobes targets through two more (four storage textures a stage). A layer the frame does not hold is a
1×1 stand-in. Transparency and transmission are shaded apart.

The binning mode and the surfaces' format are run-time world options by their fields, held over the
quality preset (no preset level writes them), changed later by `world.shading` from the next frame
(`packages/sdk-core/src/contracts/shadingOptions.ts`); a value they do not take is refused:

```ts
const world = createWorld(canvas, { shadeBinningMode: 'quad' })
world.shading = { shadeBinningMode: null } // back to the preset's, here the default
world.shading = { clearCoatNormal: true } // a clear coat keeps a bottom normal
```

| Field | Meaning | Default |
| - | - | - |
| `shadeBinningMode` | `'auto'` as each class asks, `'pixel'` every pixel alone, `'quad'` by 2 × 2 quad | `'auto'` |
| `irisNormal` | `false`: iris by the eye's `tangent` direction; `true`: by an iris normal of its own | `false` |
| `clearCoatNormal` | `false`: a clear coat shares its base's normal; `true`: it keeps a bottom normal | `false` |
| `normalCurvatureScale` | scale of the roughness a `normalCurvatureToRoughness` material takes from its vertex normal; any number, held to [0, 2] where read | `1` |
| `normalCurvatureBias` | bias added to that roughness; any number, held to [-1, 1] where read | `0` |
| `normalCurvatureExponent` | exponent on the normal's change across a pixel; any number, held to [0.05, 20] where read | `0.333` |

**The normal curvature** (`normalCurvatureRoughness`, `normalCurvatureApply`,
`lighting/ormWgsl.ts`).
A material with `normalCurvatureToRoughness` has its roughness raised to
`saturate(max(dNdx·dNdx, dNdy·dNdy)^exponent · scale + bias)`, `dNdx` and `dNdy` the change of the
interpolated vertex normal across one pixel, taken before the normal map, a graph's normal or a
hair's tangent bends the normal.

- The option is bit 11 of the record's model word (`NORMAL_CURVATURE_MODEL_BIT`), carried by the
  blend vertex stage to bit 31 of the item's flags (`normalCurvatureFlag`,
  `NORMAL_CURVATURE_FLAG_MASK`).
- The curve is three words of the resolve's and blend view's uniforms (`normalCurvature`). A voxel
  pixel has no curvature; the clear coat takes the same curvature for its roughness.

**The clear coat** (`lighting/direct/clearCoatWgsl.ts`, `lobesWgsl.ts`). A pixel whose coat weight
is
above zero keeps its coat in the lobes target (`PHYSICAL_SURFACE_FLAG`: weight, roughness, normal;
`hasLightingLobes`) and is lit as the reference's clear coat model (`coatedLight`, `coatedPoint`,
`coatedLamp`, `coatedRect`, asked by `surfaceLight`, `lampLight`, `rectLightSplit` where
`hasCoat`):

- Top layer: context on the coat's normal, highlight direction moved by the light's sphere (sphere
  sine narrowed by the coat's roughness, `1 − R²` over `1 − α_c`), specular
  `c · direct · D · Vis · F`
  of a dielectric of reflectance 0.04 and its sphere's energy (`lobeEnergy`).
- Base lit through it: context refracted into the coat (`refractedCoat`, index 1.5), transmittance
  of a metal base (`coatTransmittance`), diffuse `mix(d, (1 − F)² · T · d, c)`, specular
  `mix(F(plain), (1 − F)² · T · F(refracted), c)`; an anisotropic base's `D`, `Vis` along its
  tangent
  frame; a rectangle's two fitted lobes; no legacy energy conservation.
- Indirect: diffuse colour and specular reflectance are the base's remapped (`coatRemap`,
  `clothDiffuse`, `indirectF0`); reflections combine base and coat (`reflectionShare`: base times `1 − F`, plus the
  coat's reflection times `F`, `F = c ·` the coat's energy at its roughness and view angle; the
  base's grazing term scaled by `1 − c`; `coatLayerKeep` is `1 − F`).
- The coat's normal is the base's unless `clearCoatNormal` is on (`uni.clearCoatNormal`, `ShadeUni`,
  `BlendView`): then the surface normal is the coat's and the base's the graph's
  `clearCoatBottomNormal` (or the material's normal map), their octahedral difference stored in 8
  bits quartered, and the coat's highlight is found without the Newton step.

A row whose geometry carries tangents (`FLAG_HAS_TANGENT`) interpolates them per vertex (a quantized
page's stored ones, `FLAG_TANGENT`: `geometry/cluster/decodeWgsl.ts:clusterTangent`; a source
buffer's floats otherwise: `pageTangent`, `visibility/shader/pageGeometryWgsl.ts`); any other row
rebuilds the frame from the triangle's edges and texture deltas
(`geometry/cluster/cotangentFrameWgsl.ts`). That frame (`storedTangentFrame` in the opaque resolve,
`blendTangentFrame` in the blend pass) serves the normal map, the anisotropy direction and the clear
coat's normal map (`physicalValues`); without stored tangents each map builds its own. A page stores
tangents only for a mesh the compiler was told to (`meshBuild.storedTangents`,
[docs/COMPILER.md](../compiler/how-a-mesh-coarsens.md#mesh-build-settings)).
