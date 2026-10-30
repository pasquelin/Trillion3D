# Material pass shading settings

`world.shading`: material pass settings, each also a `createWorld` option:

- `gpuTimingDetail` (`false`). `true`: a frame sampled for GPU timing times shading bins and each
  class's shading apart, `Trillion3D material bins` and `Trillion3D material shading <class key>`
  in `gpuPassMs.passes`; same image.
- `gpuShadeStage` (`0`: whole kernel). `1` to `5`: diagnostic stopping each class's shading after
  its binned pixel, triangle header and indices, vertex fetch and transform, interpolation and
  derivatives, material and surface; writes no surface; classes recompiled. With `gpuTimingDetail`,
  the difference of two stages' `Trillion3D material shading <class key>` times is the stage's cost.
- `shadeBinningMode` (`'auto'`: as each material's shading asks, per pixel for every engine
  material; `'pixel'`; `'quad'` per 2 × 2 quad). Same image in each.
- `toonReflectionQuantization` (`false`: smooth). `true`: where the toon profile's
  `specularIndirectRampRepetition` is above 0, reflections' logarithm repeats that many times and
  the fraction is read in `specularIndirectRamp`; `specularIndirectScale` applies either way.
- `toonUnifiedDiffuse` (`false`: each light ramps its own diffuse). `true`: lights add unramped
  diffuse (weight, lit cosine) to two extra lit-image targets (only while on and a material is
  toon); a step after the lights ramps the sum once at the weighted mean cosine.
- `toonProfileResolution` (`64`, default and least; up to `512`, rounded up to a multiple of 8):
  texels toon ramps and pattern images bake at.
- `shadingRoughDiffuse` (`true`): energy-preserving rough diffuse; rectangle-light and indirect
  diffuse stay Lambert; `false`: Lambert.
- `shadingAccurate` (`true`): exact joint Smith visibility of the GGX lobe; `false`: approximation.
- `irisNormal` (`false`): iris lit by the direction its `tangent` output gives; `true`: by
  `clearCoatBottomNormal`.
- `clearCoatNormal` (`false`): coat and base share one normal; `true`: base keeps a graph's
  `clearCoatBottomNormal` output or a material's normal map, coat the `normal` output's or its own
  normal map's; difference kept as reference, 8 bits, coat highlight without the Newton step.

A write names changed settings, `null` restores a default; a value of another kind is refused by
name ([ENGINE.md](../../engine/material-surfaces.md#material-surfaces)). Changing `irisNormal`,
`clearCoatNormal`, `shadingRoughDiffuse` or `shadingAccurate` redraws a still view from next frame.

## Furnace test

`shadingFurnaceTest` (`false`) replaces the lit image, after every light, with the furnace test,
run only where `shadingFurnaceTestEnableForProject` (`false`) is true. Each pixel shows the light
its surface returns in a uniform environment of radiance 0.5, summed over
`shadingFurnaceTestSampleCount` samples (`64`, `16` to `2048`) of each of three distributions
(specular lobe, cosine hemisphere, clear coat lobe) by power heuristic; unlit pixels and background
show 0.5. An energy-conserving surface shows 0.5 or less.

```js
const world = createWorld('viewer', { shadeBinningMode: 'pixel' })
world.shading = { shadeBinningMode: 'quad' } // every material binned by quad, next frame
world.shading = { irisNormal: null } // back to the default, false
world.shading = { irisNormal: true } // an eye's iris has the normal of the clearCoatBottomNormal output
world.shading = { gpuTimingDetail: true } // the material pass's bins and each class timed apart, next sampled frame
world.shading = { gpuShadeStage: 3 } // each class's shading stops after its vertex fetch and transform, next frames
world.shading = { clearCoatNormal: true } // a clear coat keeps the clearCoatBottomNormal output as its base's normal
world.shading = { shadingRoughDiffuse: false } // Lambert's diffuse everywhere, whatever the roughness
world.shading = { shadingAccurate: false } // the approximate specular visibility, a mobile project's
world.shading = { toonReflectionQuantization: true } // the toon reflections quantised by their profile's specularIndirectRamp, where its repetition is above 0
world.shading = { toonUnifiedDiffuse: true } // the toon diffuse ramp applied once to the sum of the lights, so overlapping lights give one set of bands
world.shading = { toonProfileResolution: 128 } // the toon ramps and pattern images baked at 128 texels, finer bands and patterns
world.shading = { shadingFurnaceTestEnableForProject: true, shadingFurnaceTest: true } // the furnace test: each lit pixel shows the light its surface returns in a uniform environment of radiance 0.5
world.shading = { shadingFurnaceTestSampleCount: 256 } // 256 samples of each of the three distributions at each pixel, less noise
```
