# Reservoir gather of the indirect light

`finalGatherMethod: 'reservoirs'` gathers the indirect light of the opaque surfaces by reservoirs
instead of screen probes. One ray a tile of pixels (`reservoirGatherDownsampleFactor`, 2 by default) is
cast through the scene's triangles in a uniform direction of the hemisphere and lit by the surface cache
where it hits. Its hit is kept in a reservoir, then:

1. merged with the reservoirs of the last image round where the surface stood
   (`reservoirGatherTemporalResampling`);
2. merged with those round it in space (`reservoirGatherSpatialResampling`,
   `reservoirGatherSpatialResamplingNumPasses` passes of `reservoirGatherSpatialResamplingNumSamples`
   neighbours);
3. upsampled to the pixels (`reservoirGatherUpsampleMethod`: `'spiral'`, `'jitteredBilinear'` or
   `'passthrough'`);
4. accumulated over the images (`reservoirGatherTemporal`,
   `reservoirGatherTemporalMaxFramesAccumulated`);
5. blurred where it is still noisy (`reservoirGatherBilateralFilter`).

- It needs the scene traces (`screenProbeSceneTraces` with `screenProbeHardwareRayTracing`, both on by
  default); without them the screen probes gather, as they do when the level casts no probes. The rays
  walk the scene's triangles in a compute stage whatever the device's hardware, so the choice costs
  what that walk costs.
- A short-range, full-resolution occlusion (the contact shadows the spatial filtering lacks) is added to
  the gathered light (`reservoirGatherShortRangeAO`, on by default; its reach is
  `reservoirGatherShortRangeAOMaxScreenTraceFraction` of the screen width, 0.02 by default). It is the
  screen probes' occlusion pass, so it follows their switch (`screenProbeShortRangeOcclusion`),
  reduction (`screenProbeShortRangeAODownsampleFactor`) and strength (`screenProbeOcclusionIntensity`).
- Turning the temporal resampling's reset on (`reservoirGatherTemporalResamplingResetHistory`) discards
  the reservoirs of the last image once, at the image it turns on.
- When the reservoirs of the chosen reduction do not fit the device's largest storage buffer (a 4K image
  at the default 2), the reduction is raised until they do.
- Every setting is read again at each image and its default is the reference's.

```js
// Reservoirs gather the indirect light: a ray every third pixel, one spatial pass, validated every eight images to follow a change of the lighting faster, with a wider contact occlusion.
const world = createWorld('viewer', {
  finalGatherMethod: 'reservoirs',
  reservoirGatherShortRangeAOMaxScreenTraceFraction: 0.03,
  reservoirGatherDownsampleFactor: 3,
  reservoirGatherSpatialResamplingNumPasses: 1,
  reservoirGatherValidateTemporalReservoirsEveryNFrames: 8,
  reservoirGatherUpsampleMethod: 'jitteredBilinear',
})
```
