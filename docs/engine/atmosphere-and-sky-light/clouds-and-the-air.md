# Clouds and the air

**Shade clouds cast on air.** Each march step of the sky table, haze volume, march-drawn sky,
opaque-surface haze, cloud haze and capture haze reads the clouds' shadow maps of the air's two
lights (`cloudShadowOnAir`, `lighting/atmosphere/cloudShadowRead.ts`; strength
`cloudShadowOnAtmosphereStrength`) and, for the first light, the clouds' sky occlusion map
(`cloudSkyOcclusionAt`, `airSkyOcclusion`): that light's multiple-scattered share is multiplied by it,
`multiScatter(...) · shade.z · scattering`; the second light's isn't. The map holds the sky
light's `cloudAmbientOcclusionStrength`. Air-only tables read neither. Sky light capture marches its sky from its place in planet frame (distance from centre, no
lower than an eye, `sceneToPlanet`) through the same shade (`skyFaceProgram`), from maps built this
image (`cloudShadowOf`, `captureCloudsOf`). No clouds: `cloudShadowStandIn`.

**Clouds' sky occlusion map** (`modules/sky/clouds/skyOcclusionRun.ts`). Where
`cloudSkyOcclusionWanted` (quality's `cloudSkyAO` and a world-affecting sky light with
`cloudAmbientOcclusion` on), the shadow maps' pass builds it after the lights' maps: cloud shadow
trace (`cloudShadowMain`) along the planet vertical, from a square under the camera snapped to
`cloudSkyAOSnapKm` (0 or less read as 0.1 m), size `cloudAmbientOcclusionExtentKm`, into a map of
512 × scale texels a side (at most `cloudSkyAOResolutionMax`), the sky light's strength, no depth
bias, `cloudSkyAOTraceSamples` samples per ray, no temporal blend; then, with `cloudSkyAOFiltering`,
the hemisphere filter (`skyOcclusionFilterMain`: 16 directions) into a second texture. Matrix
and far depth: shadow block (`clipSky`, `far.z`; far depth 0 = no occlusion); map: the sets' `ao`.

**What clouds read of the air.** When clouds ask (`airRequests`, `encodeAtmosphere.ts`) the air
builds the haze's light alone and the air's alone in two same-cell volumes (`hazeSeparate`,
`radianceMie`, `radianceRay` apart, ozone absorption split half and half), and the haze around a
capture's place (`capture360`: longitude, sine of latitude, distance), read with
`hazeOnly`, `airOnly`, `captureHaze` (`separatedWgsl.ts`). `cloudHighQualityAerial` marches haze to
the cloud depth (`cloudHaze`, `cloudHazeWgsl.ts`).

**Clouds with no atmosphere.** Clouds draw (view, shadow maps, capture) without air. They stand on a planet of their own `planetRadiusKm` under plane `y = 0`, over a
stand-in air (`airlessAirOf`, `writeAirlessFrame`): white transmittance, no haze.

- Air block holds the air's lights as they are, illuminance × transmittance 1 (`packAtmosphere`),
  where a clouds part is followed (`SceneLightStore.setAirlessSuns`); zero with no atmosphere and
  no clouds.
- Distant sky light on clouds = directionless diffuse light (`skyHarmonicsSimple` at origin,
  `cloudDistantSky`), from trace group 2 (`CloudTraceKey.skyLight`).
- `cloudsOn` off: no clouds part is followed (`skyAtQuality`).
- Not reproduced: with no atmosphere reference puts planet centre at view origin, bending the ground
  bounce's normal (`groundContribution`, off by default); ours keeps the true normal.

**Capture's clouds and sun shadow.** With `skyLightShadowFromOpaque` the sun's opaque-scene shadow
lights capture's clouds (key program `captureCloudKey`), which read the shadow map (`cloudSampleLightShadowMap`); capture waits for
the program to compile (`cloudsCompiled`).

**Clouds' time.** Clouds drift by the image's world time (`WebgpuRun.graphClocks.time`; wall clock
with no world). A held image is redrawn (`cloudsMoved`) when the world clock moved while wind drifts
clouds, a storm flashes, or a cut leaves rebuilding unfinished; not for the wall clock alone.

**Cloud's self-shade.** Trace program has two forms (`CloudTraceKey.volumeShadowMap`): default marches
shade toward each light (`cloudShadow`); with material `rayMarchVolumeShadow` off it reads lights'
shadow maps in group 2 (`cloudMapShadow`, `cloudShadowDepth`); capture too.

**Density bound.** Every march first probes a point (`cloudProbeAt`, `CloudSite`), skips it where conservative
density isn't above 0 (`cloudProbeDense`), reads the rest of the material after (`cloudPointOf`).
Lamps' shadow rays read the whole material.

**Empty-space table** (`modules/sky/clouds/emptySpace.ts`). Where `cloudEmptySpaceSkipping` is on and
the image isn't a reflection (`CloudTraceKey.emptySpace`), a compute pass writes, before the view's
trace, a 32 × 32 `r32float` kilometre table over the view: a 64-thread group per texel, a thread per
each of 64 slices of `cloudEmptySpaceSkippingDepthKm` along the ray through the texel (orthographic
view: from the texel's own point), each asking the material's empty-space output
(`cloudMaterialEmptySpace`) at its froxel centre and, with `cloudEmptySpaceSkippingCorners`, its
eight corners; greatest kept. A slice answering above 0 stores its distance moved by
`cloudEmptySpaceSkippingSliceBias` slices, others the whole depth; the texel holds the nearest. Trace
(`traceExtraWgsl.ts`, group 2, binding 0) starts a ray at `uint(start / step)` steps along. Built-in
material leaves the output unconnected: its table holds the bias alone. One table per view (`emptySpaceTableSlot`).
