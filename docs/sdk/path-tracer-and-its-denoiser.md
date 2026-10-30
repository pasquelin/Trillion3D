# Path tracer and its denoiser
`pathTracing` (`false`) draws the view with the path tracer, a render mode of its own that traces
the scene's triangles bounce after bounce and adds the samples of each image to those of the one
before while the view stands still. The other settings are read only when it is on; each default is
the reference's.

| Setting | Default | Meaning |
| --- | --- | --- |
| `pathTracingSamplesPerPixel` | `2048` | samples each pixel gathers before the image stops accumulating |
| `pathTracingMaxBounces` | `32` | bounces of a path |
| `pathTracingCompactionDepth` | `6` | the last bounce whose live paths are packed together (under 1 or past the last bounce: every bounce); the bounces after it go on over the last packed list without packing again, as `createScene({ pathTracing: true, pathTracingCompactionDepth: 3 })` does for a scene whose paths mostly end early |
| `pathTracingIndirectDispatch` | `false` | dispatch each packed bounce over exactly the live paths (the same image; a matter of speed) |
| `pathTracingDispatchSize` | `2048` | side in pixels of the tiles the image is traced in |
| `pathTracingExperimental` | `false` | rarely used modes; adaptive sampling needs it |
| `pathTracingAdaptiveSampling` | `false` | stop tracing pixels whose error is under the threshold |
| `pathTracingAdaptiveSamplingErrorThreshold` | `0.001` | that error |
| `pathTracingAdaptiveSamplingVisualize` | `0` | `1` active pixels, `2` sample counts, `3` to `7` error mip levels |
| `pathTracingProgressDisplay` | `true` | bar of the samples gathered |
| `pathTracingWiperMode` | `false` | path tracer drawn right of the cursor only |
| `pathTracingDenoiser` | `true` | denoise at the last sample |
| `pathTracingDenoiserNormalSpace` | `0` | `0` world, `1` camera-space normals for the denoiser |
| `pathTracingSpatialDenoiser` | `true` | the denoiser's spatial stage (edge-aware, guided by albedo, normals and variance) |
| `pathTracingTemporalDenoiser` | `false` | the temporal stage, which needs an earlier denoised image |
| `pathTracingTemporalDenoiserMode` | `1` | `0` and `1` at the last sample, `2` at every image |
| `pathTracingDenoiserVarianceType` | `1` | prepass variance: `0` per colour channel, `1` luminance, albedo and normal length |
| `pathTracingDenoiserOutputVarianceTexture` | `false` | always write the variance image |
| `pathTracingDenoiserRankedLuminanceVariance` | `false` | rank the channels before taking the luminance for the variance |
| `pathTracingTemporalDenoiserVisualizeMotionVector` | `false` | draw the motion found over the image |
| `pathTracingTemporalDenoiserSubPixelOffset` | `true` | refine the motion under a pixel |
| `pathTracingTemporalDenoiserKappa` | `-1` | fall-off of the history weight (`-1` from `DeltaE`) |
| `pathTracingTemporalDenoiserEta` | `1` | error under which the history keeps its full weight (`-1` one just-noticeable difference) |
| `pathTracingTemporalDenoiserDeltaE` | `5` | colour difference at which the history weight reaches zero |
| `pathTracingTemporalDenoiserDeltaEHighFrequency` | `2.1` | per-pixel colour difference from which the history is cut |
| `pathTracingTemporalDenoiserAlpha` | `1` | weight of the history in the average |
| `pathTracingTemporalDenoiserSource` | `0` | motion estimated on `0` denoised radiance, `1` normals, `2` albedo, `3` raw radiance, else a fusion of variances |
| `pathTracingTemporalDenoiserSubPixelOffsetStartMip` | `8` | coarsest pyramid level with a sub-pixel estimate |
| `pathTracingTemporalDenoiserMotionOperation` | `1` | `1` subtracts the motion of the image against itself |
| `pathTracingTemporalDenoiserVisualizeWarp` | `0` | `1` the warped history, `2` with the weights |
| `pathTracingTemporalDenoiserDistanceMetrics` | `2` | `0` luminance, `1` colour distance, `2` CIE 2000 difference |
| `pathTracingTemporalDenoiserTotalVariation` | `true` | less history where the error varies a lot |
| `pathTracingTemporalDenoiserPatchCount` | `1` | patches merged in the temporal blend (`1` to `16`) |
| `pathTracingVisualize` | `'none'` | draws a field of what each pixel sees in place of the lit image, one sample and no denoiser: `Radiance` (emission), `WorldNormal`, `WorldSmoothNormal`, `WorldGeoNormal`, `WorldTangent`, `BaseColor`, `DiffuseColor`, `SpecularColor`, `TransparencyColor`, `TransparencyCount` (translucent surfaces the ray goes through), `Metallic`, `Specular`, `Roughness`, `Anisotropy`, `IOR`, `ShadingModel`, `LightingChannelMask`, `WorldPosition`, `LightGridCount`, `LightGridAxis`, `LightGridListHash`, `LightGridSingular`, `VolumeLightCount`, `HitKind`, `SSSColor`, `SSSRadius`, `SSSWeight`, `SSSPhase`, `FuzzColor`, `FuzzRoughness`, `FuzzAmount`, `BSDFOpacity`, `BackfacingNormal`, `TriangleID`, `InstanceID`, `ClusterID`; `PrimaryRays` is the path tracer itself with no air or cloud, denoiser or adaptive sampling; `'none'` the lit image. The views see every surface the ray goes through and add their colours in proportion to what they cover |
| `pathTracingVisualizeIncludeTranslucent` | `true` | the views see the meshes that are translucent whole; `false`, the rays go through them |
| `pathTracingVisualizeSamplesPerPixel` | `1` | samples the `PrimaryRays` view gathers (the other views take one) |
| `pathTracingVisualizeMaxCount` | `16` | lights taken as the red end of the ramp of the views that turn a count into a colour (past it, pink) |
| `pathTracingVisualizeAmbientOcclusionMaxDistance` | `2` | metres the occlusion ray goes that shades the views of the payload; negative shades by the facing ratio |
| `pathTracingMISMode` | `2` | `0` material samples alone, `1` light samples alone, `2` both weighed against each other |
| `pathTracingMISCompensation` | `true` | the sky's importance sampling leaves out what the material's samples find (needs mode `2`) |
| `pathTracingMaxPathIntensity` | `24` | brightest a path off the camera's ray adds (`1` to `65504`) |
| `pathTracingApproximateCaustics` | `true` | roughen the paths that would make caustic speckles |
| `pathTracingEnableEmissive` | `true` | emissive surfaces light the scene |
| `pathTracingBackgroundAlpha` | `0` | alpha of a pixel that meets nothing |
| `pathTracingSamplerType` | `0` | `0` a sequence for each pixel, `1` one sequence across the image |
| `pathTracingFrameIndependentTemporalSeed` | `true` | the random sequence goes on across restarts |
| `pathTracingSkylightCaching` | `true` | keep the sky's sampling tables between images |
| `pathTracingFilterWidth` | `3` | width of the anti-aliasing filter of the camera's rays (`0` to `64`); `3` is a Gaussian of half a pixel |
| `pathTracingVisibleLights` | `0` | `0` no light seen by the camera, `1` all, `2` the sky alone |
| `pathTracingLightGridResolution` | `256` | side of the light culling grid (rounded up to a power of two) |
| `pathTracingLightGridMaxCount` | `128` | most lights a cell keeps (`1` to `256`) |
| `pathTracingLightGridAxis` | `-1` | axis the lights are projected along, `-1` the best |
| `pathTracingEnableReferenceAtmosphere` | `-1` | `1` the paths trace the air as a volume, `0` the sky light stands for it, `-1` the view's post process setting (off where it sets none) |
| `pathTracingAtmosphereOpticalDepthLUTResolution` | `512` | side of the optical depth table the traced air reads its transmittance from (held to what the device makes a texture of) |
| `pathTracingAtmosphereOpticalDepthLUTNumSamples` | `16384` | samples integrated for each texel of that table |
| `pathTracingEnableAtmosphereGround` | `false` | the camera's rays see the planet's ground under the traced air (paths that scattered in it always do) |
| `pathTracingUseAnalyticTransmittance` | `true` | transmittance read from the table; `false` estimated by stepping through the volume |
| `pathTracingMaxRaymarchSteps` | `768` | most steps a ray takes through a volume |
| `pathTracingVolumeMISMode` | `1` | how lamps and rectangles light a volume (the traced air and the clouds): `0` by the scattering events the density gives; `1` by a point drawn on the ray's stretch of the volume with a density that follows the light's reach (equi-angular sampling), the events then lighting by the suns and the sky alone |
| `pathTracingEnableReferenceClouds` | `true` | the paths march the cloud layer's material as a volume (needs the traced air and a sky with a clouds part); `false` leaves the clouds to the sky light |
| `pathTracingCloudAccelerationMapResolution` | `512` | side of the map that bounds the march through the clouds: for each column of the layer, its densest cloud and the heights it was found at (`1` to `4096`) |
| `pathTracingCloudAccelerationMapNumSamples` | `64` | samples of the cloud material each image adds to each texel of that map (`1` to `65536`) |
| `pathTracingCloudAccelerationMapVisualize` | `false` | draw the map in place of the clouds, to judge its resolution |
| `pathTracingCloudMultipleScatterMode` | `1` | `0` none: the material's approximation of multiple scattering is ignored and the roughness cutoff applies; `1` the material's approximation, the cutoff applying; `2` by the paths alone, the cutoff lifted |
| `pathTracingCloudRoughnessCutoff` | `0.05` | roughness of a path beyond which the clouds are not marched (`0` to `1`) |

Current limits: a hit's material is read back from the lit image where the surface shows, else from
the surface cache's cards; there are no glass, subsurface, cloth or hair lobes, no capsule lights,
light profiles, light functions or rectangle light textures; the spatial stage is the engine's own
edge-aware filter (the reference's is an external neural plug-in, not shipped); the atmosphere and
the clouds are not traced.

```js
// A path-traced view of 256 samples, 8 bounces, adaptive sampling on.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingSamplesPerPixel: 256,
  pathTracingMaxBounces: 8,
  pathTracingExperimental: true,
  pathTracingAdaptiveSampling: true,
  // Sample the lights alone (no material samples), the camera seeing every light.
  pathTracingMISMode: 1,
  pathTracingVisibleLights: 1,
})
```

```js
// The light grid's cells drawn on the first surface of every pixel, coloured by their lights up to 8.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingVisualize: 'LightGridCount',
  pathTracingVisualizeMaxCount: 8,
  pathTracingVisualizeAmbientOcclusionMaxDistance: 1,
})
```

```js
// The count of translucent surfaces each ray goes through, with the meshes that are translucent whole seen, then the path tracer's own primary rays gathering 4 samples.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingVisualize: 'TransparencyCount',
  pathTracingVisualizeIncludeTranslucent: true,
})
const primary = createWorld('viewer', {
  pathTracing: true,
  pathTracingVisualize: 'PrimaryRays',
  pathTracingVisualizeSamplesPerPixel: 4,
})
```

```js
// The temporal denoiser at every image, history cut sooner, the motion drawn.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingTemporalDenoiser: true,
  pathTracingTemporalDenoiserMode: 2,
  pathTracingTemporalDenoiserDeltaE: 2,
  pathTracingTemporalDenoiserVisualizeMotionVector: true,
})
```

```js
// The air traced as a volume: the paths scatter in it, the planet's ground visible to the camera.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingEnableReferenceAtmosphere: 1,
  pathTracingEnableAtmosphereGround: true,
  pathTracingAtmosphereOpticalDepthLUTResolution: 256,
  pathTracingUseAnalyticTransmittance: false,
})
```

```js
// The lamps lighting the traced air by the density's events alone, no point drawn on the ray toward them.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingEnableReferenceAtmosphere: 1,
  pathTracingVolumeMISMode: 0,
})
```

```js
// The clouds of the sky marched by the paths: a finer map, more samples of the material per image, the material's own approximation of multiple scattering, clouds seen down to rough paths.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingEnableReferenceAtmosphere: 1,
  pathTracingEnableReferenceClouds: true,
  pathTracingCloudAccelerationMapResolution: 1024,
  pathTracingCloudAccelerationMapNumSamples: 128,
  pathTracingCloudMultipleScatterMode: 1,
  pathTracingCloudRoughnessCutoff: 0.2,
})
```

```js
// The map that bounds the cloud march drawn in place of the clouds, to judge its resolution.
const world = createWorld('viewer', {
  pathTracing: true,
  pathTracingEnableReferenceAtmosphere: 1,
  pathTracingCloudAccelerationMapVisualize: true,
})
```
