# Exposure and the display curve

The image the lighting writes is linear radiance. Composition multiplies it by an exposure, then the
display curve and the transfer bring it into [0, 1]: one read of the tone table
([The tone table](the-display-finishing.md#the-display-finishing)), baked from the scene's curve and the
colour settings (`lighting/deferred/shaders.ts`, `lighting/toneLutRead.ts`,
`lighting/toneMappingWgsl.ts`). `world.exposure` is `'auto'`, the default (`true`), a number above zero
(a fixed exposure, used as it is) or `false` (an exposure of 1). `world.toneMapping` is `'filmic'` by
default, or `'none'`, the light as it is (`TONE_MAPPING_RANK`,
`packages/sdk-core/src/scene/core/environment.ts`); the film curve's method (the curve itself or the
standard output transform of the film industry's colour system) is the colour grading's
(`tonemappingMethod`).

**Automatic exposure** (`post/exposure/`). Where `world.exposure` is `'auto'` the exposure is found by
one of three methods, `exposureMethod` of `world.exposureSettings`
(`packages/sdk-core/src/contracts/exposureOptions.ts`).

- `'histogram'`, the default, measures the image composition reads, on the GPU, every image. A compute
  pass bins the log2 luminance of the texels of the scene's half-size image (the chain the bloom and the
  local exposure read) into a 64-bucket histogram over a span of stops (workgroup-local counters, one
  merge into the buffer, `meterWgsl.ts`); then one thread takes the mean of the logs between two
  percentiles (`exposureLowPercent`, `exposureHighPercent`), holds it to a range, and moves the exposure
  toward `2^bias · 0.18 / mean`: linearly while it is farther than the transition distance,
  exponentially inside, at the rise's or the fall's speed, with the frame's time. A view cut
  (`gate.temporalRevision`) and the first image jump to the target.
- `'basic'` is the cheaper measure. The image is brought down by the scene's chain (`createSceneChain`:
  the half-size image, then the quarter-size level, each the mean of the 4 × 4 texels around the one
  above); a setup (`basicSetup`, `post/exposure/basicWgsl.ts`) places each quarter-size texel's colour
  (as it is, divided by the pre-exposure) as a log luminance, no lower than a luminance of 0.0001 and
  held between −10 and 20 stops, over the histogram's range, into the alpha of a texture of the same
  place; four more levels, each the mean of the 4 × 4 texels around the one above, bring it to a
  sixty-fourth of the image on each axis, and one workgroup of 256 lanes sums that grid's texels, each
  lane a sixteenth of each axis (`laneRange`), each texel weighted by the metering mask at its corner (no
  less than 0.05, 1 with no mask) times `exposureBlackBucketWeight` where its value falls in the darkest
  bucket; every lane leaves its four sums (weighted value, weight, value, count) in its own words of the
  measure's buffer. The exposure's mean is the weighted mean of the grid's log luminance over all the
  lanes; the local exposure's mean gain is, as the reference does it, the mean of the gain each lane's
  own plain mean gives, weighted by the lane's texel count, not the gain at the grid's plain mean, which
  differs as soon as the contrasts above and under middle grey differ (a grid half 2 stops over its mean
  and half 2 under, highlight contrast 0.5, shadow contrast 1: 0.76 against 1.0). The two scene chains
  are one: the finishing's chain is begun on the metered image before the exposure
  (`beginFinishScene`) and the basic method draws its grid from the same half-size and quarter-size
  levels, once.
- `'manual'` measures nothing: the exposure is the camera's, below.

Every method shares the speeds, the transition, the range, the bias, the compensation curve and the jump
at a first image and a cut. A view lit by no declared lamp has no radiance to expose, whatever the
method.

The exposure the update leaves is copied, on the GPU, into the composition's view uniform, so an image
is shown at the exposure measured on it, and into a staging buffer of the readback ring
(`gpu/core/readbackRing.ts`), which brings it to the CPU a few images late (the meter's last readback, 1
until one came back). **One exposure.** The CPU reads it once an image: `beginPreExposure` reads the
held exposure (`heldExposureOf`: a number or the manual method) or the meter's last readback and keeps
it in `PreExposure.exposure` (`held` the exposure the meter writes). The lighting parameters, the
pre-exposure every light is written multiplied by, the temporal resolve's weights and its correction by
the ratio of one image's scale (the exposure over its pre-exposure) to the last's, the reflections'
ranges and the radiance a mirror sees of the background, the display layers read it from there, so the
lag is theirs and the image's never. On the GPU the meter's exposure buffer is the one source for every
method: its `shown` word is copied into the composition's view uniform and from there into the
finishing's, its grey into the finishing's, its words into the readback. A frame waits for nothing: no
stall, no readback awaited. A view whose exposure is still moving toward its target is drawn again
(`exposureMoving`, `frame/loop/unsettled.ts`) and a still one is held. A view lit by no declared lamp
shows its albedo as it is (`UNLIT_COMPOSITIONS`): no exposure, no curve, whatever `world.exposure` says;
in a lit view the flat `scene.background` is scene radiance, exposed and shown like any pixel
([The background](the-display-finishing.md#the-display-finishing)).

**Adaptation runs on the world's time.** The exposure moves by the seconds the world lived between two
images (`createWorldFrames().clock`, the sum of the intervals the clips and the controllers integrate, a
pause of the loop counted as one running interval, `session/world/frames/frames.ts`), handed to the
engine by the world as `worldClock` (`EngineContext.worldClock`, read at each image). A world that holds
still does not move its exposure; a hitch moves it by one interval, not by the seconds the page lost. An
engine opened with no world (a bench, a test) adapts on the image clock it keeps
(`WebgpuRun.graphClocks`, taken once an image from the wall clock; the material graphs read the same two
clocks). The engine has no global pause or slow motion of its own: what it reads is the world's
integrated seconds, so a frame the loop slept through counts as one running interval, and a subsystem's
own scale (the physics' `timeScale`, the animation banks') does not reach it.

**Manual exposure** (`exposureMethod: 'manual'`, the camera's). The camera's EV100 is `log2(aperture² · shutter speed ·
100 / ISO)` where `exposureApplyPhysicalCamera` is `true` (the default), with `exposureCameraShutterSpeed`
(60, in 1/s, from 0.01 to 8000) and `exposureCameraIso` (100, from 1); the aperture is the depth of
field's (`effect.depthOfField`, f/4 where the chain holds none, drawing or not). Where it is `false`,
EV100 is 0. The white point is the saturation luminance times `2^EV100`, and the exposure is
`2^exposureBias` times the compensation curve's factor over the white point. The curve is read at the
EV100 an image with the white point for its mean would give (the white point over middle grey over the
saturation luminance), or at a mean of 1 where the low and the high percentile are the same. With the
physical camera off, and the default lens, the exposure is two to the bias.

No pass runs: the exposure is worked out on the CPU (`manualExposure`,
`packages/sdk-core/src/contracts/exposureManual.ts`) and is the lighting parameter. It is also written
into the meter's exposure buffer, so a switch back to a measuring method starts from the exposure on
screen and adapts over a normal frame, not from the exposure of the last measured image over the seconds
the manual stretch lasted, **and only when it changed**: a held exposure does no work on the GPU
(`ExposureMeter.hold`, `writeHeld`, `post/exposure/meterRun.ts`). `writeHeld` compares the words it would
write (the exposure, the one asked, the mean, the compensation; the scale shown over the pre-exposure, a
local mean of 1, the middle grey) with the ones the buffer last received and writes the range from the
first changed word to the last, in one write, and none while the buffer still holds them; a measuring
image's update rewrites the buffer, so the first held image after one writes it again. A held image
copies only the scale shown into the view's uniform, makes no staging copy and no `mapAsync`; the meter
knows the exposure at once (`read.last`, `asked` and `local` set by the hold) and tags each readback with
the number of holds, so a copy still in flight from before a hold, which says an exposure that is no
longer the view's, is ignored. A **number** (`world.exposure = 0.5`) is a fixed exposure: radiance is
multiplied by it as it is, the bias, the curve and the camera ignored. The old multiplier `n` is the same
exposure as the manual method with the camera off and the bias `log2(n)`, or as a fixed EV100 of
`−log2(n · saturation luminance)`; no value the number took is lost.

**Lens attenuation** (`exposureLensAttenuation`, 0.78, from 0.01). The luminance that saturates the
sensor at EV100 0 is `0.78 / lens attenuation` (`exposureSaturationLuminance`, 1 at the default, where
lighting is unitless). Every EV100 of the exposure is read from it: the range of the mean, the
histogram's stops, the curve's read, the camera's white point. A lower attenuation raises it.

**Metering mask** (`exposureMeterMask`, `explorer.setExposureMeterMask(image)`, none by default). A
picture whose red channel weighs where the image is measured: bright spots weigh the exposure, dark ones
leave it out. It is a plain 8-bit texture read bilinearly at its first level; the histogram method reads
it at the corner of each 2 × 2 quad of half pixels, at the quad's first (`quadWeight`), and multiplies
the pixel's share of its two buckets by it, the basic method once a texel of its grid. No mask: no
texture is made, no read is done.

**The local exposure's middle grey** is 0.18 times the exposure compensation (the bias and the
compensation curve's factor at the frame's mean) and two to `localExposureMiddleGreyBias`. It has one
source, the exposure buffer's `exposure[1].z` (the log2 of it): the update derives it for a measured
image, the CPU writes it for a held one (a fixed exposure's has neither bias nor curve; a manual
exposure's cancels the bias and keeps the curve's factor, as the reference does), and the finishing
copies it from there every image (`ExposureMeter.copyGrey`). A fixed exposure and the manual method
measure nothing: their local exposure's mean gain is 1.

```js
const world = createWorld('viewer', {
  exposureMeterMask: await loader.imageBitmap('centre-weighted.png'),
})
world.exposureSettings = { exposureMethod: 'basic' } // the cheaper measure, weighed by the mask
explorer.setExposureMeterMask(null) // every pixel counts the same again
// The camera's exposure: no measure — f/2.8, 1/125 s, ISO 400, no bias.
world.effects.add(effect.depthOfField({ aperture: 2.8 }))
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureCameraShutterSpeed: 125,
  exposureCameraIso: 400,
  exposureBias: 0,
}
// The old multiplier 0.25, as a manual bias with the camera off.
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureApplyPhysicalCamera: false,
  exposureBias: Math.log2(0.25),
}
world.exposure = 0.25 // the same, as a fixed exposure
```

**Pre-exposure** (`post/exposure/pre.ts`, `preExposureOf`). Options of `world.exposureSettings`:
`preExposure` (on by default); `preExposureOverride` (0 by default, names the number instead);
`cachedLightingPreExposure` (4 stops by default, the fixed number of the lighting kept from one image to
the next, below). Every light an image holds is written already multiplied by one number, the image's
pre-exposure: the exposure the CPU knows (`PreExposure.exposure`: a fixed or manual exposure,
`heldExposureOf`, else the meter's last readback) times the luminance of the scene colour tint times the
local exposure's mean gain (`averageLocalExposureOf`: the mean, over the histogram's buckets, of the log
of the gain the local exposure gives a pixel of that luminance, computed by the exposure's update with
the exposure and read back with it, `meterWgsl.ts`; 1 where the local exposure does not run and for a
manual exposure), 1 for a view that is not lit, that shows raw values or that runs no post (a capture).
It is fixed once an image (`beginPreExposure`) and read, for the whole image, from `preExposureOf`. The
composition multiplies the image by the exposure over that number (`view.preExposure.y`: the exposure
the GPU measured on the image divided by the pre-exposure it holds, `meterWgsl.ts`, copied into the
view's uniform and the finishing's), so the picture is the same with the option off. What it gains is
range: a half float holds the light of the image at any exposure.

- The writers apply it at the end of what they sum, over `preExposed(rgb)` (`post/exposure/preWgsl.ts`:
  the light multiplied) or, for a surface's final write, `preExposedClipped(rgb)`: the term multiplied
  by the pre-exposure first, the whole colour then held to 32256, as a base pass clips its output. They
  are: the lit image's base pass (the colour pass, `lighting/deferred/colourPassWgsl.ts`: the emission,
  an unlit surface, the background), the translucent layers (`blend/shader.ts`, the transmissive stage
  in `blend/transmission/transmitWgsl.ts`), the particles (`particles/gpu/particlesWgsl.ts`), the
  clouds' traced luminance and the fog laid on them (`modules/sky/clouds/traceWgsl.ts`,
  `composeWgsl.ts`), the fog volume (above). The fog pass (`lighting/fog/fogPass.ts`) writes the fog's
  inscattering over `preExposed`, and the sky (`lighting/atmosphere/skyWgsl.ts`) is another's writer.
- Reflections, the bounce, the fog's analytic law and the haze are sums of the surface's terms, in the
  units of the light before it is written, and need none of their own.
- What is kept from one image to the next is brought to the new number by the ratio of the
  pre-exposures: the temporal history's colour (`historyRead`), the fog volume's cells, the clouds'
  reconstruction history (`sampleHistoryLight`), and the last lit image the reflections and the screen
  probes read, divided by the pre-exposure it was lit with (`ReflectionView.radiance.w`).
- The histogram measures the image divided by it; the local exposure, the bloom, the depth of field and
  the light shafts work on the image multiplied by the exposure over it.
- The image before's pre-exposure is kept once, on the pre-exposure (`PreExposure.previous`), and the
  temporal pass reads it from there (`pre.now / pre.previous`); the settings of the film and of the
  colour grading that the pre-exposure and the finishing both read are read by one module
  (`post/finish/settings.ts`).

The sky light's real-time capture has a pre-exposure of its own, one number for every image and every
view whatever `preExposure` says: 2 to the minus `cachedLightingPreExposure` (4 stops, 1/16; from −16
to 16; `cachedPreExposure`, `packages/sdk-core/src/contracts/exposureOptions.ts`). Its faces are
written multiplied by it (the sky, held to 32256 per channel after the multiplication, the distant fog's
light, the clouds' traced luminance, the lower hemisphere's colour) and the light's colour
(`skyLightColor`) is multiplied by its inverse, once, in the uniform every reader of the cube and of its
harmonics reads, so the sky's radiance comes back whole while the capture keeps its range over about −8
to +12 stops of exposure. A captured scene and a specified cubemap are written at 1 and read at 1.

```js
const world = createWorld('viewer')
world.exposureSettings = { preExposure: false } // every light written as it is; the same picture
world.exposureSettings = { preExposureOverride: 0.25 } // lights written multiplied by 0.25
world.exposureSettings = { cachedLightingPreExposure: 8 } // the sky light's capture kept for −4 to +16 stops
```

**Exposure compensation curve** (`packages/sdk-core/src/contracts/exposureCurve.ts`, option
`exposureCurve` of the session and of `createWorld`, `explorer.setExposureCurve`; none by default, which
is a factor of 1 and the same image). Stops added to the exposure's target by how bright the scene is.
The curve (keys by EV100, linear, constant or cubic between them, an extrapolation on each side) is
baked once into 64 half-float samples of `2^compensation` over EV100 -10 to +20 (`exposureCurveTable`:
the same option object gives the same table), held in a uniform of the update (`meter.ts`). The update
reads it at the frame's mean luminance, before the range holds it: `ev = log2(mean / 0.18)`, the place
in the table `(ev + 10) · 63 / 30` clamped, the two samples around it mixed (`post/exposure/curveWgsl.ts`),
and multiplies the exposure's bias by the factor (`meterWgsl.ts`, `adapt`). The factor is part of the
bias the readback and the local exposure's middle grey take.

```js
const world = createWorld('viewer', {
  exposureCurve: [
    [-4, 1],
    [0, 0],
    [8, -1],
  ], // [EV100, stops]: dark scenes brighter, bright ones darker
})
explorer.setExposureCurve([{ ev: 0, compensation: 0.5, interpolation: 'cubic' }, [10, -0.5]])
explorer.setExposureCurve(null) // no curve
```

**The film curve** (`lighting/filmCurveWgsl.ts`, constants `filmCurveConstants.ts`) is the curve the tone
table bakes for the scene's `'filmic'` display curve. In order: exposed sRGB radiance to the film's wide
working gamut, a widening of bright saturated colours, a blue correction, a glow and a red pull by hue
in the grading gamut, a first desaturation, the curve of each channel (a toe and a shoulder in log
luminance: slope 0.88, toe 0.55, shoulder 0.26, black clip 0, white clip 0.04), a second desaturation,
the blue correction undone, back to sRGB. Middle grey in is middle grey out. A light the curve does not
define, a black one whose logarithm divides by nothing, is shown black (`finiteValue`,
`lighting/storableWgsl.ts`), as the reference's unsigned targets show it.
