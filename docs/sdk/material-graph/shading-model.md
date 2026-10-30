# Shading model per pixel

Where the material says `shadingModel: 'fromMaterialExpression'` (any other name, `defaultLit` by
default, is the material's own and the graph's output is ignored), `g.output('shadingModel', model)`
picks the shading model of each pixel of a lit surface the opaque or masked pass shades (a
translucent surface shades by the material's). The value is the rounded number of the reference's
own enumeration (`GRAPH_SHADING_MODELS`): `unlit` 0, `defaultLit` 1, `subsurface` 2,
`preintegratedSkin` 3, `clearCoat` 4, `subsurfaceProfile` 5, `twoSidedFoliage` 6, `hair` 7, `cloth`
8, `eye` 9, `singleLayerWater` 10, `thinTranslucent` 11. The lighting has the physical model, the
unlit one, the thin subsurface, the clear coat, the cloth, the preintegrated skin, the hair and the
eye. Per model:

- `unlit`: shows its emission alone, as an unlit material does.
- `twoSidedFoliage`: reads `subsurfaceColor` as its thin transmission (a two-sided surface).
- `subsurface`: lit as `defaultLit` and, beside it, gets from every light a term of its own on any
  side: an in-scattering lobe against the eye, a wrapped back scattering weighed by the `opacity`
  output (read once a `shadingModel` is wired) and the material's occlusion, times the
  `subsurfaceColor` output (or its transmitted colour, hue-shifted, where the light is shadowed),
  which also adds to its indirect diffuse colour.
- `clearCoat`: has the coat that `clearCoat` and `clearCoatRoughness` give.
- `cloth`: has the cloth lobe, its fuzz colour the `subsurfaceColor` output and its amount the
  `cloth` output (the cloth takes the place of the coat and the anisotropy).
- `preintegratedSkin`: lit as `defaultLit` and, beside it, lets light through its thickness: the
  light's cosine mapped to [0, 1] and one minus the `opacity` output (read for an opaque surface
  once a `shadingModel` is wired) address a table the reference ships (the `PreintegratedSkinBRDF`
  image, read from a file beside the module), times the `subsurfaceColor` output, which also adds
  to its indirect diffuse colour.
- `hair`: neither diffuse nor specular lobe but the hair's own scattering (reflection,
  transmission, internal reflection and a multiple scattering approximation): the `normal` output is
  the fibre's direction (toward its root), `roughness` and `specular` shape the lobes and `metallic`
  is the scatter amount; a hair reflects nothing and its indirect diffuse colour is its response to
  the environment.
- `eye`: the specular lobe of a dielectric and, in place of the diffuse lobe, a term that lights the
  sclera by the light's cosine and the iris by the cosine of its normal with a caustic, mixed by the
  iris mask. The mask and the distance of the iris are the `clearCoat` and `clearCoatRoughness`
  outputs, the iris direction the `tangent` output as a direction in the world's axes (unwired, the
  iris looks along `(0, 0, -1)`, the reference's own decoded default); the metalness is not read.
  With `world.shading = { irisNormal: true }` (default `false`, the reference's `r.IrisNormal`) the
  iris has a normal of its own: the `clearCoatBottomNormal` output (a float3 in tangent space like
  `normal`, the iris plane normal; unwired, the `tangent` output, or the surface's normal if that is
  unwired too) is the iris normal, the caustic normal is the plane normal bent toward the opposite
  of the normal by the iris mask times the `clearCoatRoughness` output, and the eye's specular is
  held at 0.25.
- `subsurfaceProfile`: lit as `defaultLit` with the Burley diffuse and two specular lobes, then
  scattered (see "The scattering of the light under a surface"); its `opacity` output (at 0.1 or
  under, the pixel is plain) is the share of the profile's radius it scatters over.
- Any other model: lit as `defaultLit`.

A graph that wires no `shadingModel` keeps the behaviour of its wired outputs (a coat where
`clearCoat` is wired, a cloth where `cloth` is wired and no model is, a thin transmission where
only `subsurfaceColor` is).

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
