# Post-process materials
`material.postProcess(...)` is a material of the post-process domain: a graph (`material.graph('postProcess')`) evaluated at every pixel of the image by a full-screen pass. Its `emissive` output is the colour the pixel takes; its `opacity` output is the alpha, where `blendableOutputAlpha` is on. Its texture coordinates (`texCoord`) are the pixel's place in the image, 0 to 1. A material with no graph gives its `emissive` times `emissiveIntensity`. It joins the image as a blendable of the chain, `world.effects.blendables.add(material, weight)` (a weight above 0 and at most 1, 1 by default), and is left out of the image by `remove` and `clear`.

The `sceneTexture(id, uv, filtered)` node reads the image: `sceneColor` (the lit image, as stored), `postProcessInput0` (the image so far, the one the previous material or pass left), `sceneDepth` and `customDepth` (the distance along the view axis, in metres, in all four channels; a far value where the custom depth holds nothing), `customStencil` (the stencil value, in all four channels; 0 where it holds nothing). Its `uv` is the pixel's own place unless wired; its outputs are `rgb`, `r`, `g`, `b`, `a` and `rgba`. `sceneTextureSize(id, inverse)` is the size in pixels of the image, or one over it. Before the tone mapping the images the material reads are multiplied by one over the exposure the image is held at, and the colour it writes by the exposure, unless `disablePreExposureScale` is on. The scene textures exist in this domain alone; a graph that reads a texture (`textureSample`) or a world position is refused, and the material is not drawn.

| Property | Default | Meaning |
| --- | --- | --- |
| `blendableLocation` | `'sceneColorAfterTonemapping'` | where the material joins the image: `'sceneColorBeforeDof'` and `'sceneColorAfterDof'` (the lit image, around the depth of field), `'sceneColorBeforeBloom'` (after the temporal pass and the motion blur), `'sceneColorAfterTonemapping'` (the display image). `'translucencyAfterDof'`, `'ssrInput'` and `'replacingTonemapper'` are accepted but never drawn: the frame names each material that asks for one (`BLENDABLE_LOCATION_NOT_DRAWN:<place>`, in the graph refusals) |
| `blendablePriority` | `0` | the order of the materials of one location: the lower runs first, equal ones in the order they were added |
| `blendableOutputAlpha` | `false` | writes the `opacity` output as the pixel's alpha, and blends by the material's `blending` where `transparent` is on; off, the colour replaces the pixel's and its alpha is kept |
| `isBlendable` | `true` | off, the parameters of the material are not blended by the weights of a material added twice: each add is a node of its own, drawn as it is (it is not left out) |
| `disablePreExposureScale` | `false` | reads and writes the colours without the exposure |
| `enableStencilTest` | `false` | draws only the pixels whose custom stencil passes `stencilCompare` against `stencilRefValue`; the other pixels keep the colour they had. It needs `customDepth: 3` (without the stencil the test is not made), and is not made after the tone mapping |
| `stencilCompare` | `'less'` | `'less'`, `'lessEqual'`, `'greater'`, `'greaterEqual'`, `'equal'`, `'notEqual'`, `'never'` or `'always'`: the pixel is kept where `stencilRefValue`, compared so, holds against its stencil |
| `stencilRefValue` | `0` | the value the stencil is compared to, 0 to 255 |

A material added with a weight under 1 mixes the values of its graph's parameters with the ones its nodes start from, by that weight. The view's settings (`world.postProcessMaterial`, `world.setPostProcessMaterial(field, value)`) are the reference's:

| Setting | Default | Meaning |
| --- | --- | --- |
| `postProcessMaterials` | `true` | the show flag of the materials; off, the image is the one without them |
| `postProcessDisableMaterials` | `false` | turns them all off whatever the show flag says |
| `postProcessAllowStencilTest` | `true` | lets a material draw only the pixels its stencil test passes; off, it draws every pixel |
| `postProcessAllowBlendModes` | `true` | lets a material that outputs alpha blend by it; off, it replaces the pixel |

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

Where the image holds no blendable, nothing is made, drawn or kept, and the image is the one it would be without the feature.
