# Material pass shading settings

`world.shading` holds the material pass's settings, each also a `createWorld` option:

- `gpuTimingDetail` (`false`, the default: the material pass is one timed pass). `true`: a frame
  sampled for the GPU timing times its shading bins and each material class's shading as passes of
  their own, `Trillion3D material bins` and `Trillion3D material shading <class key>` in
  `gpuPassMs.passes`; the image is the same.
- `gpuShadeStage` (`0`, the default: the whole shading kernel). `1` to `5`: a diagnostic that stops
  each class's shading after its binned pixel, its triangle's header and indices, its vertex fetch
  and transform, its interpolation and derivatives, its material and surface, writing no surface (the
  image is not the scene's), each class compiled again. With `gpuTimingDetail`, the difference of two
  stages' `Trillion3D material shading <class key>` times is the stage's cost.
- `shadeBinningMode` (`'auto'`: each material's pixels binned as its shading asks, one by one for
  every material of the engine; `'pixel'` one by one; `'quad'` by 2 × 2 quad). The image is the same
  in each mode.
- `toonReflectionQuantization` (`false`, the default: the reflections of a toon surface are smooth).
  `true`: where the toon profile's `specularIndirectRampRepetition` is above 0, the logarithm of the
  reflections has its value repeated that many times and the fraction of it read in the profile's
  `specularIndirectRamp`; the profile's `specularIndirectScale` applies either way.
- `toonUnifiedDiffuse` (`false`, the default: each light applies the diffuse ramp of a toon surface
  to its own diffuse light). `true`: each light's draw, with its own shadows, adds its diffuse light
  unramped, with its weight and the cosine it lit at, to two more targets of the lit image's pass
  (they exist only while the setting is on and a material is toon), and a step after the lights
  applies the ramp once, at the weighted mean cosine, to the sum.
- `toonProfileResolution` (`64`, the default and the least; up to `512`, rounded up to a multiple of
  8): the texels the ramps and the pattern images of the toon profiles are baked at.
- `shadingRoughDiffuse` (`true`, the default): a lit surface's diffuse light is the
  energy-preserving rough diffuse of a new project, brighter against the light and darker at grazing
  views as the roughness grows, a rectangle light's and the indirect light's staying Lambert's;
  `false`: Lambert's diffuse whatever the roughness.
- `shadingAccurate` (`true`, the default): the visibility of the lit surfaces' specular lobes is the
  exact joint Smith term of the GGX lobe; `false`: its approximation.
- `irisNormal` (`false`, the default): an eye's iris is lit by the direction its `tangent` output
  gives; `true`: by an iris normal of its own, `clearCoatBottomNormal`.
- `clearCoatNormal` (`false`, the default): a clear coat and its base share one normal; `true`: the
  base keeps the normal of a graph's `clearCoatBottomNormal` output or of a material's normal map, and
  the coat the `normal` output's or its own normal map's, their difference kept as the reference
  keeps it, in 8 bits, and the coat's highlight found without the Newton step.

A write names the settings it changes, `null` one's default; a value of another kind is refused by
name ([ENGINE.md](../../engine/material-surfaces.md#material-surfaces)). Changing `irisNormal`,
`clearCoatNormal`, `shadingRoughDiffuse` or `shadingAccurate` redraws a still view from the next
frame.

## Furnace test

`shadingFurnaceTest` (`false`, the default) replaces the lit image, after every light, by the furnace
test of the shading, run only where `shadingFurnaceTestEnableForProject` (`false`, the default) is
true. At each pixel it shows the light its surface returns toward the eye in a uniform environment of
radiance 0.5 (a directional light of 0.5 from every direction sampled), summed over
`shadingFurnaceTestSampleCount` samples (`64`, from `16` to `2048`) of each of three distributions
(the specular lobe, the cosine hemisphere, the clear coat's lobe) weighed by their power heuristic;
an unlit pixel and the background show 0.5. A surface that conserves energy shows 0.5 or less; one
that shows more creates light.

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
