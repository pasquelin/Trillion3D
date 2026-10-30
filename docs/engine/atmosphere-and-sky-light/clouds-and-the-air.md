# Clouds and the air

**Shade the clouds cast on the air.** Besides the opaque scene's shade, each step of the march of the
sky table, haze volume, sky drawn by march, haze on opaque surfaces, haze on a cloud and haze around a
capture reads the clouds' shadow maps of the air's two lights (`cloudShadowOnAir`,
`lighting/atmosphere/cloudShadowRead.ts`; the share of light the cloud leaves, laid in by the light's
`cloudShadowOnAtmosphereStrength`) and, for the first light, the clouds' sky occlusion map
(`cloudSkyOcclusionAt`, `airSkyOcclusion`): that light's multiply-scattered share is multiplied by it,
`multiScatter(...) · shade.z · scattering`, the second light's left as is. The occlusion map already
holds the sky light's `cloudAmbientOcclusionStrength`, so it is read whole, with no strength of its
own. The tables depending on the air alone (the multiple-scattering table, the mean sky at 6 km) read
neither. The sky light's capture marches its sky from its place in the planet's frame (its distance
from the planet's centre, held no lower than an eye, `sceneToPlanet`, as the haze around it) through
the same shade (`skyFaceProgram`, the haze around its place `capture360`), from the maps built this
image (the capture's clouds read `cloudShadowOf` where the capture asks, `captureCloudsOf`, not a
copy: a getter, so nothing is stale), the stand-in that shades nothing where the scene has no clouds
(`cloudShadowStandIn`).

**The clouds' sky occlusion map** (`modules/sky/clouds/skyOcclusionRun.ts`). Where
`cloudSkyOcclusionWanted` (the quality's `cloudSkyAO` and a sky light, that affects the world, with
`cloudAmbientOcclusion` on), the shadow maps' pass builds it after the lights' maps, whether or not a
light casts one: the cloud shadow trace (`cloudShadowMain`) along the planet's vertical, from a square
round the point of the planet's surface under the camera snapped to `cloudSkyAOSnapKm` (a length of 0
or less read as 0.1 m), its size set by `cloudAmbientOcclusionExtentKm`, into a map of 512 × the scale
texels a side (at most `cloudSkyAOResolutionMax`), with the sky light's strength, no depth bias,
`cloudSkyAOTraceSamples` samples a ray and no temporal blend; then, with `cloudSkyAOFiltering`, the
hemisphere filter (`skyOcclusionFilterMain`: 16 directions, the optical depth that of the mean of the
transmittances) into a second texture. Its matrix and far depth are in the shadow block (`clipSky`,
`far.z`; a far depth of 0 reads as no occlusion), the map in the sets' `ao`.

**What the clouds read of the air.** Besides the haze surfaces read, when the clouds ask
(`airRequests`, `encodeAtmosphere.ts`) the air builds the haze's light alone and the air's alone in two
volumes of the same cells (`hazeSeparate`, the march keeping `radianceMie` and `radianceRay` apart, the
ozone's absorption shared half and half), and the haze all around a capture's place (`capture360`: a
longitude and the sine of the latitude across, the distance down), read with `hazeOnly`, `airOnly` and
`captureHaze` (`separatedWgsl.ts`). The clouds' high-quality haze (`cloudHighQualityAerial`) marches
it for the pixel to the cloud's depth (`cloudHaze`, `cloudHazeWgsl.ts`).

**Clouds with no atmosphere.** The clouds need an atmosphere no more than the reference's do: a clouds
part is drawn in the view, its shadow maps and the sky light's capture whether or not the scene has an
air. With none they stand on the planet of their own `planetRadiusKm` under the plane `y = 0`, over a
stand-in air (`airlessAirOf`, `writeAirlessFrame`): a white transmittance, no haze (the haze on the
clouds and the sun's per-sample tint are off), the frame's eye where it stands, written once per image
whoever asks first.
- The air's block holds the lights of the air as they are, the clouds' illuminance outside the air
  times a transmittance of one (`packAtmosphere`: no disk, the light's own illuminance, its place in
  the light buffer kept for the clouds' shade), where a clouds part is followed and asks for them
  (`SceneLightStore.setAirlessSuns`; the block of a scene with no atmosphere and no clouds stays all
  zero).
- The distant sky light that lights the clouds is the sky light's own diffuse light of no direction
  (the harmonics' first terms, `skyHarmonicsSimple` at the origin, `cloudDistantSky`), read from group
  2 of the trace (`CloudTraceKey.skyLight`).
- The clouds' own switch is `cloudsOn`: off, no clouds part is followed (`skyAtQuality`, applied each
  image from the session's live sky quality settings).
- A reference quirk is not reproduced: with no atmosphere the reference puts the planet's centre at
  the view's origin, which bends the ground bounce's normal (`groundContribution`, off by default)
  toward the view ray; ours keeps the true normal.

**The capture's clouds and the sun's shadow.** The sky light's capture traces its clouds with the
program of its key (`captureCloudKey`): the sun's shadow in the opaque scene lights them where the
capture asks for the opaque scene's shadows (`skyLightShadowFromOpaque`) and the clouds read the
shadow map (`cloudSampleLightShadowMap`), through the shadow maps' channel of the sun the view uses;
the program is compiled when first asked and the capture waits for it (`cloudsCompiled`).

**The clouds' time.** The clouds drift by the world's time of the image, the clock the material graphs
read (`WebgpuRun.graphClocks.time`, taken once per image from the world's clock, the wall clock in an
engine with no world): a paused world holds the clouds still, and every reader of an image (the view's
trace, the shadow maps, the sky occlusion, the sky light's capture) reads the one value. A held image
is drawn again (`cloudsMoved`) when the world's clock moved since the last image drawn while a wind
drifts the clouds, while a storm flashes, and while a cut leaves the rebuilding unfinished; not when
the wall clock alone ran on.

**The cloud's shade on itself.** The trace program has two forms (`CloudTraceKey.volumeShadowMap`): the
default marches the shade toward each light (`cloudShadow`); with the material's `rayMarchVolumeShadow`
off it reads the lights' shadow maps in group 2 (`cloudMapShadow`, `cloudShadowDepth`), nothing
marched. The sky light's capture takes the same choice and reads the maps built this image.

**The density bound.** Every march (view, shadow ray, ground's bounce, shadow map) probes a point first
(`cloudProbeAt`: its altitude in the layer and the layout's four pattern reads, with the layout's
screen gradients, `CloudSite`), skips it where the conservative density is not above 0
(`cloudProbeDense`) and reads the rest of the material only after (`cloudPointOf`): an empty sample
costs the four reads. The lamps' shadow rays read the whole material (no bound to test).

**The empty-space table** (`modules/sky/clouds/emptySpace.ts`). Where `cloudEmptySpaceSkipping` is on
and the image is not a reflection (`CloudTraceKey.emptySpace`), a compute pass writes, before the
view's trace and from the very block the trace reads, a 32 × 32 table of `r32float` kilometres over
the view: a group of 64 threads to a texel, one to each of 64 slices of `cloudEmptySpaceSkippingDepthKm`
along the ray through the texel (an orthographic view's from the texel's own point, as the trace's
rays), each asking the material's empty-space output (`cloudMaterialEmptySpace`) at the centre of its
froxel and, with `cloudEmptySpaceSkippingCorners`, at its eight corners, keeping the greatest. A slice
answering above 0 stores its own distance moved by `cloudEmptySpaceSkippingSliceBias` slices, the
others the whole depth, and the texel holds the nearest. The trace (`traceExtraWgsl.ts`, group 2,
binding 0) starts a ray at `uint(start / step)` steps along, and steps over empty air one sample at a
time, so the table's texels never show. The built-in material leaves the output unconnected, which
says matter is there everywhere: its table holds the bias alone. The table is the view's, made on the
first ask and kept with its images (`emptySpaceTableSlot`).

