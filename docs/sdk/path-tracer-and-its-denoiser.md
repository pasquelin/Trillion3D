# Path tracer and its denoiser

`pathTracing` (`false`) draws the view with the path tracer, accumulating samples while the view
stands still. Other settings are read only when it is on; defaults are the reference's.

| Setting | Default | Meaning |
| - | - | - |
| `pathTracingSamplesPerPixel` | `2048` | samples before accumulation stops |
| `pathTracingMaxBounces` | `32` | bounces |
| `pathTracingCompactionDepth` | `6` | last bounce whose live paths are packed (under 1 or past the last: every bounce), as `createScene({ pathTracing: true, pathTracingCompactionDepth: 3 })` |
| `pathTracingIndirectDispatch` | `false` | dispatch each bounce over exactly the live paths |
| `pathTracingDispatchSize` | `2048` | tracing tile side, pixels |
| `pathTracingExperimental` | `false` | rare modes; adaptive sampling needs it |
| `pathTracingAdaptiveSampling` | `false` | stop pixels whose error is under the threshold |
| `pathTracingAdaptiveSamplingErrorThreshold` | `0.001` | that error |
| `pathTracingAdaptiveSamplingVisualize` | `0` | `1` active pixels, `2` sample counts, `3` to `7` error mips |
| `pathTracingProgressDisplay` | `true` | sample bar |
| `pathTracingWiperMode` | `false` | path tracer right of the cursor only |
| `pathTracingDenoiser` | `true` | denoise at the last sample |
| `pathTracingDenoiserNormalSpace` | `0` | `0` world, `1` camera-space |
| `pathTracingSpatialDenoiser` | `true` | spatial stage (edge-aware, guided by albedo, normals, variance) |
| `pathTracingTemporalDenoiser` | `false` | temporal stage; needs an earlier denoised image |
| `pathTracingTemporalDenoiserMode` | `1` | `0`, `1` last sample, `2` every image |
| `pathTracingDenoiserVarianceType` | `1` | `0` per colour channel, `1` luminance, albedo, normal length |
| `pathTracingDenoiserOutputVarianceTexture` | `false` | always write the variance image |
| `pathTracingDenoiserRankedLuminanceVariance` | `false` | rank channels before the luminance variance |
| `pathTracingTemporalDenoiserVisualizeMotionVector` | `false` | draw the motion |
| `pathTracingTemporalDenoiserSubPixelOffset` | `true` | sub-pixel motion |
| `pathTracingTemporalDenoiserKappa` | `-1` | history weight fall-off (`-1` from `DeltaE`) |
| `pathTracingTemporalDenoiserEta` | `1` | error under which history keeps full weight (`-1` one just-noticeable difference) |
| `pathTracingTemporalDenoiserDeltaE` | `5` | colour difference where history weight is zero |
| `pathTracingTemporalDenoiserDeltaEHighFrequency` | `2.1` | per-pixel difference from which history is cut |
| `pathTracingTemporalDenoiserAlpha` | `1` | history weight in the average |
| `pathTracingTemporalDenoiserSource` | `0` | motion from `0` denoised radiance, `1` normals, `2` albedo, `3` raw radiance, else fused variances |
| `pathTracingTemporalDenoiserSubPixelOffsetStartMip` | `8` | coarsest level with a sub-pixel estimate |
| `pathTracingTemporalDenoiserMotionOperation` | `1` | `1` subtracts the image's motion against itself |
| `pathTracingTemporalDenoiserVisualizeWarp` | `0` | `1` warped history, `2` with weights |
| `pathTracingTemporalDenoiserDistanceMetrics` | `2` | `0` luminance, `1` colour, `2` CIE 2000 |
| `pathTracingTemporalDenoiserTotalVariation` | `true` | less history where error varies |
| `pathTracingTemporalDenoiserPatchCount` | `1` | patches merged (`1` to `16`) |
| `pathTracingVisualize` | `'none'` | per-pixel field instead of the lit image (one sample, no denoiser): `Radiance`, `WorldNormal`, `WorldSmoothNormal`, `WorldGeoNormal`, `WorldTangent`, `BaseColor`, `DiffuseColor`, `SpecularColor`, `TransparencyColor`, `TransparencyCount`, `Metallic`, `Specular`, `Roughness`, `Anisotropy`, `IOR`, `ShadingModel`, `LightingChannelMask`, `WorldPosition`, `LightGridCount`, `LightGridAxis`, `LightGridListHash`, `LightGridSingular`, `VolumeLightCount`, `HitKind`, `SSSColor`, `SSSRadius`, `SSSWeight`, `SSSPhase`, `FuzzColor`, `FuzzRoughness`, `FuzzAmount`, `BSDFOpacity`, `BackfacingNormal`, `TriangleID`, `InstanceID`, `ClusterID`; `PrimaryRays` is the path tracer without air, clouds, denoiser, adaptive sampling; `'none'` lit |
| `pathTracingVisualizeIncludeTranslucent` | `true` | views see translucent meshes whole; `false`, rays go through |
| `pathTracingVisualizeSamplesPerPixel` | `1` | samples of `PrimaryRays` |
| `pathTracingVisualizeMaxCount` | `16` | lights at the ramp's red end (past it, pink) |
| `pathTracingVisualizeAmbientOcclusionMaxDistance` | `2` | metres of the occlusion ray in payload views; negative: facing ratio |
| `pathTracingMISMode` | `2` | `0` material samples, `1` light samples, `2` both |
| `pathTracingMISCompensation` | `true` | compensates sky importance sampling (mode `2`) |
| `pathTracingMaxPathIntensity` | `24` | brightest a path off the camera ray adds (`1` to `65504`) |
| `pathTracingApproximateCaustics` | `true` | roughen caustic paths |
| `pathTracingEnableEmissive` | `true` | emissive surfaces light the scene |
| `pathTracingBackgroundAlpha` | `0` | alpha where nothing is hit |
| `pathTracingSamplerType` | `0` | `0` sequence per pixel, `1` one across the image |
| `pathTracingFrameIndependentTemporalSeed` | `true` | sequence continues across restarts |
| `pathTracingSkylightCaching` | `true` | keep sky tables between images |
| `pathTracingFilterWidth` | `3` | camera-ray filter width (`0` to `64`); `3` is a half-pixel Gaussian |
| `pathTracingVisibleLights` | `0` | `0` no light seen by the camera, `1` all, `2` sky alone |
| `pathTracingLightGridResolution` | `256` | culling grid side (up to a power of two) |
| `pathTracingLightGridMaxCount` | `128` | lights per cell (`1` to `256`) |
| `pathTracingLightGridAxis` | `-1` | projection axis, `-1` best |
| `pathTracingEnableReferenceAtmosphere` | `-1` | `1` paths trace the air as a volume, `0` sky light stands for it, `-1` the view's post process setting (off where none) |
| `pathTracingAtmosphereOpticalDepthLUTResolution` | `512` | optical depth table side (held to the device's texture limit) |
| `pathTracingAtmosphereOpticalDepthLUTNumSamples` | `16384` | samples per texel |
| `pathTracingEnableAtmosphereGround` | `false` | camera rays see the ground under the traced air |
| `pathTracingUseAnalyticTransmittance` | `true` | transmittance from the table; `false` by stepping |
| `pathTracingMaxRaymarchSteps` | `768` | steps through a volume |
| `pathTracingVolumeMISMode` | `1` | lamps and rectangles lighting a volume: `0` by scattering events; `1` by a point drawn on the ray's stretch (equi-angular), events then lighting by suns and sky only |
| `pathTracingEnableReferenceClouds` | `true` | paths march the cloud layer's material (needs traced air and a sky with clouds); `false` clouds stay in the sky light |
| `pathTracingCloudAccelerationMapResolution` | `512` | cloud march bounding map side (`1` to `4096`) |
| `pathTracingCloudAccelerationMapNumSamples` | `64` | samples per texel per image (`1` to `65536`) |
| `pathTracingCloudAccelerationMapVisualize` | `false` | draw the map instead of the clouds |
| `pathTracingCloudMultipleScatterMode` | `1` | `0` material's approximation ignored, cutoff applies; `1` material's approximation, cutoff applies; `2` paths alone, cutoff lifted |
| `pathTracingCloudRoughnessCutoff` | `0.05` | path roughness beyond which clouds are not marched (`0` to `1`) |

Limits: a hit's material is read from the lit image where the surface shows, else from surface
cache cards; no glass, subsurface, cloth, hair lobes, capsule lights, light profiles, light
functions, rectangle light textures; the spatial stage is the engine's edge-aware filter
(reference: external neural plug-in, not shipped); atmosphere and clouds are not traced.

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
