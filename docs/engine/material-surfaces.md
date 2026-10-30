# Material surfaces

The visibility buffer is resolved into the material surfaces in compute, one indirect dispatch per
material class over that class's pixels alone (`materials/classes/materialPasses.ts`). The surfaces
and the feedback target are cleared first, by a pass of no draw; then one compute pass sorts every
pixel into the bin of its class — the shading bins (`materials/classes/shadeBins.ts`,
`visibility/shader/shadeBinsWgsl.ts`, `visibility/shader/shadeBinKernelsWgsl.ts`). The depth export
writes each pixel's shading mask once (`r32uint`: bit 0 set, the bin from bit 4, the bin's quad mode
at bit 18; `visibility/raster/exportWgsl.ts`), and the kernels read only that; a tile with no pixel
of any bin leaves before any vote, and a mode no bin holds has no pass. On a device whose subgroups
are the 64-lane workgroup the votes and places are subgroup operations with no barrier, else the
workgroup's barriers:

- a count of each bin's elements, a workgroup a 16 × 16 tile, a lane a 2 × 2 quad of it along the
  Z-order — four lanes in a row a 4 × 4 square, sixteen an 8 × 8 one —, the tile's bins voted one
  at a time, the greatest first, one counter add a tile and a bin;
- a reservation, a lane a bin, of each bin's range of the elements and its dispatch, a 64-lane
  workgroup every 64 lanes;
- a scatter of each element into its bin's range: the sixteen lanes of an 8 × 8 square all of the
  voted bin's make a full tile, written from the range's start — one shading workgroup's 64 pixels
  —, every other lane's elements loose, from its end, each in lane order.

A bin holds pixels — one word each, its coordinates and its write mask — or quads — two words, the
top-left pixel and a nibble a pixel of the quad —, the reference's two modes: a class whose shading
reads a neighbour's derivative is binned by quad, any other by pixel. Every gradient a class reads
is its triangle's own, analytic (`uvGradients`, from the steps of `pixelBarycentric`), so its bin holds pixels unless the
`shadeBinningMode` setting forces quads; a quad's lane on a pixel of another class has nothing to
write and nothing to give, and does nothing (`shadesPixel`). Each class the resident clusters wear
(`PresentClasses`, counted as the clusters' records are written) then shades its bin (`shade_cs`, `visibility/shader/shadeEntryWgsl.ts`) and stores its pixels
(`storeSurface`, `visibility/shader/shadeOutputsWgsl.ts`): no pixel is shaded by a class it is not
of, whatever the classes' count or where their borders run. A class's kernel decodes each pixel's
own triangle from its identifier — the decoded cluster at the index the identifier names, the
triangle's corners, their attributes and world positions (`visibility/shader/pixelTriangleWgsl.ts`)
— with no per-triangle cache between the bins and the shading. The bins' head — the class word of each
class key, the surfaces' layers — and their elements are two record tables (`r32uint`, read by
load); each bin's element count, first word and mode are one `vec4u` of a read-only storage buffer.

The surfaces are two layered targets (`materials/surface/surfaceAllocation.ts`): the colours,
`rgba16float` — base colour and metalness, normal and roughness, the emission and occlusion while a
surface of the image can mark it, the thin transmission while a sheet transmits — and the words,
`r32uint` — the flags, the narrowest word a compute stage stores. A class stores every layer through
two storage bindings, the feedback target and the lobes target through two more: four storage
textures a stage, what every device holds. Each reader binds views, one layer each, in the formats
it read before; a layer the frame does
not hold is a 1×1 stand-in, and the head names to the classes the layers it holds, so no class
writes one it has not made. Lighting reads those surfaces and the depth; transparency and
transmission are shaded apart.

The binning mode and the surfaces' format are run-time settings, the reference's by default, world
options by their fields, held over the quality preset — no preset level writes them —, changed later
by `world.shading` from the next frame (`packages/sdk-core/src/contracts/shadingOptions.ts`); a value
they do not take is refused:

```ts
const world = createWorld(canvas, { shadeBinningMode: 'quad' })
world.shading = { shadeBinningMode: null } // back to the preset's, here the default
world.shading = { clearCoatNormal: true } // a clear coat keeps a bottom normal
```

| Field | Meaning | Default |
| --- | --- | --- |
| `shadeBinningMode` | `'auto'` as each class asks, `'pixel'` every pixel alone, `'quad'` by 2 × 2 quad | `'auto'` |
| `irisNormal` | `false`: the eye's iris by the direction of its `tangent`; `true`: by an iris normal of its own | `false` |
| `clearCoatNormal` | `false`: a clear coat shares its base's normal; `true`: it keeps a bottom normal | `false` |
| `normalCurvatureScale` | scale of the roughness a `normalCurvatureToRoughness` material takes from its vertex normal, any number, held to [0, 2] where read | `1` |
| `normalCurvatureBias` | bias added to that roughness, any number, held to [-1, 1] where read | `0` |
| `normalCurvatureExponent` | exponent on the normal's change across a pixel, any number, held to [0.05, 20] where read | `0.333` |

**The normal curvature** (`normalCurvatureRoughness`, `normalCurvatureApply`, `lighting/ormWgsl.ts`). A material with `normalCurvatureToRoughness` has its roughness raised to `saturate(max(dNdx·dNdx, dNdy·dNdy)^exponent · scale + bias)`, `dNdx` and `dNdy` the change of the interpolated vertex normal across one pixel, taken before the normal map, a graph's normal or a hair's tangent bends the normal. The option is bit 11 of the record's model word (`NORMAL_CURVATURE_MODEL_BIT`); the blend vertex stage carries it to bit 31 of the item's flags (`normalCurvatureFlag`, `NORMAL_CURVATURE_FLAG_MASK`). The opaque resolve builds the neighbouring weights only for a pixel whose material asks for it; a blended fragment reads the derivatives of its interpolated normal. The curve is three words of the resolve's and the blend view's uniforms (`normalCurvature`). A voxel pixel has no curvature (its shading normal is drawn, not interpolated); the clear coat takes the same curvature for its own roughness. The earlier widening of the roughness by the neighbours' bent normals is gone.

**The clear coat** (`lighting/direct/clearCoatWgsl.ts`, `lobesWgsl.ts`). A pixel whose coat weight is above zero keeps its
coat in the lobes target (`PHYSICAL_SURFACE_FLAG`, the coat's weight, roughness and normal; the lobed lighting program and the lobes
target are made wherever a surface carries one, `hasLightingLobes`) and is lit as the reference's clear coat model lights it
(`coatedLight`): the top layer's context on the coat's normal, its highlight direction moved by the light's sphere (the coat's roughness
narrows the sphere's sine, `1 − R²` over `1 − α_c`), its specular `c · direct · D · Vis · F` of a dielectric of reflectance 0.04 and its
sphere's energy (`lobeEnergy`); the base lit through it by the context refracted into the coat (`refractedCoat`, the
fixed index 1.5), the transmittance of a metal base (`coatTransmittance`), diffuse `mix(d, (1 − F)² · T · d, c)`
and specular `mix(F(plain), (1 − F)² · T · F(refracted), c)`; an anisotropic base's `D`, `Vis` along its tangent frame, a rectangle's two
fitted lobes (`coatedRect`), the legacy energy conservation: none. A point light, a lamp of size and a rectangle each have their entry
(`coatedPoint`, `coatedLamp`, `coatedRect`), `surfaceLight`, `lampLight` and `rectLightSplit` ask them where the pixel has a coat
(`hasCoat`). The indirect light's diffuse colour is the base's remapped (`coatRemap`, through `clothDiffuse`), its specular
reflectance too (`indirectF0`), and the reflections combine the base's and the coat's as the reference's layer combine does
(`reflectionShare`: the base weighed by its energy terms with the grazing term scaled by `1 − c`, times `1 − F`, the coat's reflection times
`F`, `F = c ·` the coat's energy at its roughness and angle to the view; `coatLayerKeep` is that `1 − F`). The coat's normal is the
base's unless `clearCoatNormal` is on (`uni.clearCoatNormal`, `ShadeUni` and `BlendView`, one word each): then the surface normal is
the coat's and the base's the graph's `clearCoatBottomNormal` (or the material's normal map), their octahedral difference stored in
8 bits quartered, and the coat's sphere highlight is found without the Newton step.

A normal map bends the normal in a tangent frame. A row whose geometry carries tangents
(`FLAG_HAS_TANGENT`) reads them per vertex — a quantized page's stored ones (`FLAG_TANGENT`, decoded
around the vertex's normal by `geometry/cluster/decodeWgsl.ts:clusterTangent`), a source buffer's
floats otherwise (`pageTangent`, `visibility/shader/pageGeometryWgsl.ts`) — and interpolates them;
any other row rebuilds the frame from the triangle's edges and texture deltas
(`geometry/cluster/cotangentFrameWgsl.ts`). The stored frame is the pixel's one tangent source:
decoded once (`storedTangentFrame` in the opaque resolve, `blendTangentFrame` in the blend pass), it
is the frame the normal map bends in and the one the anisotropy direction and the clear coat's
normal map take (`physicalValues`); only without stored tangents does each map build its frame from
its own coordinates. A page stores tangents only for a mesh the compiler was
told to (`meshBuild.storedTangents`, [docs/COMPILER.md](../compiler/how-a-mesh-coarsens.md#mesh-build-settings)).
