# Shading model per pixel

With material `shadingModel: 'fromMaterialExpression'` (other names, `defaultLit` by default,
ignore it), `g.output('shadingModel', model)` picks the model per pixel of a lit opaque or masked
surface (translucent: the material's). Rounded reference numbers (`GRAPH_SHADING_MODELS`):
`unlit` 0, `defaultLit` 1, `subsurface` 2, `preintegratedSkin` 3, `clearCoat` 4,
`subsurfaceProfile` 5, `twoSidedFoliage` 6, `hair` 7, `cloth` 8, `eye` 9, `singleLayerWater` 10,
`thinTranslucent` 11.

- `unlit`: emission alone.
- `twoSidedFoliage`: `subsurfaceColor` is its thin transmission.
- `subsurface`: `defaultLit` plus in-scattering and wrapped back scattering weighed by `opacity`
  (read once a `shadingModel` is wired) and occlusion, times `subsurfaceColor`.
- `clearCoat`: coat from `clearCoat`, `clearCoatRoughness`.
- `cloth`: fuzz colour `subsurfaceColor`, amount `cloth` (replaces coat, anisotropy).
- `preintegratedSkin`: `defaultLit` plus light through thickness: light cosine in [0, 1] and one
  minus `opacity` address the shipped `PreintegratedSkinBRDF` table, times `subsurfaceColor`.
- `hair`: own scattering instead of diffuse and specular: `normal` is the fibre direction (toward
  the root), `roughness` and `specular` shape the lobes, `metallic` is the scatter amount.
- `eye`: dielectric specular; sclera and iris (caustic) replace diffuse, mixed by the iris mask.
  Mask and iris distance are `clearCoat` and `clearCoatRoughness`; iris direction is
  `tangent` in world axes (unwired `(0, 0, -1)`); metalness is not read.
  `world.shading = { irisNormal: true }` (default `false`, reference `r.IrisNormal`): iris normal
  is `clearCoatBottomNormal` (float3, tangent space; unwired `tangent`, else the surface normal),
  caustic normal bent away from it by iris mask times `clearCoatRoughness`; specular held at 0.25.
- `subsurfaceProfile`: `defaultLit` with Burley diffuse and two specular lobes, then scattered (see
  "The scattering of the light under a surface"); `opacity` (at 0.1 or under, plain) is the
  scattered radius share.
- Any other: `defaultLit`.

With no `shadingModel` wired, wired outputs decide (`clearCoat`: coat, `cloth`: cloth, only
`subsurfaceColor`: thin transmission).

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
