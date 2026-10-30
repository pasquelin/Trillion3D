# Post-process materials

`material.postProcess(...)` is a post-process material: a graph (`material.graph('postProcess')`)
run per pixel. `emissive` is the colour; `opacity` the alpha, where `blendableOutputAlpha` is on.
`texCoord` is the pixel's place, 0 to 1. No graph: `emissive` times `emissiveIntensity`. `world.effects.blendables.add(material, weight)` (weight above 0, at most 1,
default 1) joins it; `remove` and `clear` take it out.

`sceneTexture(id, uv, filtered)` reads: `sceneColor` (lit), `postProcessInput0` (image so far),
`sceneDepth` and `customDepth` (metres along the view axis; far where empty), `customStencil` (0
where empty); four channels each. `uv` defaults to the pixel's place; outputs `rgb`,
`r`, `g`, `b`, `a`, `rgba`. `sceneTextureSize(id, inverse)` is the size in pixels, or one over it.
Before tone mapping, reads are multiplied by one over the exposure, writes by the exposure, unless
`disablePreExposureScale`. A graph reading a texture (`textureSample`) or a world position is
refused, the material not drawn.

| Property | Default | Meaning |
| - | - | - |
| `blendableLocation` | `'sceneColorAfterTonemapping'` | `'sceneColorBeforeDof'`, `'sceneColorAfterDof'`, `'sceneColorBeforeBloom'` (after temporal, motion blur), `'sceneColorAfterTonemapping'`. `'translucencyAfterDof'`, `'ssrInput'`, `'replacingTonemapper'` are never drawn (`BLENDABLE_LOCATION_NOT_DRAWN:<place>`) |
| `blendablePriority` | `0` | lower first, ties in add order |
| `blendableOutputAlpha` | `false` | writes `opacity` as alpha, blends by `blending` where `transparent`; off, colour replaces, alpha kept |
| `isBlendable` | `true` | off, a twice-added material is not weight-blended |
| `disablePreExposureScale` | `false` | no exposure scaling |
| `enableStencilTest` | `false` | draws only pixels whose custom stencil passes `stencilCompare` against `stencilRefValue`; needs `customDepth: 3`; not after tone mapping |
| `stencilCompare` | `'less'` | `'less'`, `'lessEqual'`, `'greater'`, `'greaterEqual'`, `'equal'`, `'notEqual'`, `'never'`, `'always'` |
| `stencilRefValue` | `0` | 0 to 255 |

A weight under 1 mixes parameters with the nodes' starting values. View settings:
`world.postProcessMaterial`, `world.setPostProcessMaterial(field, value)`.

| Setting | Default | Meaning |
| - | - | - |
| `postProcessMaterials` | `true` | show |
| `postProcessDisableMaterials` | `false` | all off whatever the show flag |
| `postProcessAllowStencilTest` | `true` | off, draw every pixel |
| `postProcessAllowBlendModes` | `true` | off, replace the pixel |

```js
// Tints the objects the custom stencil marks with 7, and leaves the others as they are.
world.customDepth = { customDepth: 3 }
statue.renderCustomDepth = true
statue.customDepthStencilValue = 7

const g = material.graph('postProcess')
const scene = g.channel(g.sceneTexture('postProcessInput0'), 'rgb')
const tinted = g.multiply(scene, g.vectorParameter('tint', [1, 0.4, 0.2, 1]))
g.output('emissive', tinted)

const tint = material.postProcess({
  graph: g,
  blendableLocation: 'sceneColorBeforeBloom',
  enableStencilTest: true,
  stencilCompare: 'equal',
  stencilRefValue: 7,
})
world.effects.blendables.add(tint)
```
