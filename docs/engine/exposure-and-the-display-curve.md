# Exposure and the display curve

Lighting writes linear radiance. Composition multiplies by exposure; one tone-table read brings it
to [0, 1] ([The tone table](the-display-finishing.md#the-display-finishing);
`lighting/deferred/shaders.ts`, `lighting/toneLutRead.ts`, `lighting/toneMappingWgsl.ts`).

- `world.exposure`: `'auto'` (default, `true`), number above zero (fixed, used as is), `false`
  (exposure 1).
- `world.toneMapping`: `'filmic'` (default) or `'none'` (light as is) (`TONE_MAPPING_RANK`,
  `packages/sdk-core/src/scene/core/environment.ts`). Film-curve method: `tonemappingMethod`.

**Automatic exposure** (`post/exposure/`). `exposureMethod` of `world.exposureSettings`
(`packages/sdk-core/src/contracts/exposureOptions.ts`):

- `'histogram'` (default): bins log2 luminance of scene half-size image texels into 64 buckets over
  a span of stops (`meterWgsl.ts`); takes mean of logs between two percentiles
  (`exposureLowPercent`, `exposureHighPercent`), holds it to a range, moves exposure toward
  `2^bias · 0.18 / mean`: linear beyond transition distance, exponential inside, at rise or fall
  speed, by frame time. View cut (`gate.temporalRevision`) and first image jump to target.
- `'basic'`, cheaper:
  - Scene chain (`createSceneChain`; finishing begins on it, `beginFinishScene`): half-size, then
    quarter-size, each 4 × 4 mean; setup
    (`basicSetup`, `post/exposure/basicWgsl.ts`): quarter-size texel (÷ pre-exposure) as log
    luminance, floor 0.0001, −10..20 stops.
  - Four more 4 × 4-mean levels reach 1/64 image per axis; one 256-lane workgroup sums that grid
    (`laneRange`), texel weight = metering mask (min 0.05, 1 with no mask) ×
    `exposureBlackBucketWeight` in darkest bucket; exposure mean = weighted mean of log luminance.
- `'manual'`: measures nothing; camera's exposure, below.

All methods share speeds, transition, range, bias, compensation curve, jumps.

**One exposure.** CPU reads it once per image: `beginPreExposure` takes held exposure
(`heldExposureOf`: number or manual) or meter last readback (`gpu/core/readbackRing.ts`, a few
images late, 1 until one returns) into `PreExposure.exposure` (`held` = exposure meter writes). On GPU, meter exposure buffer is the
one source: `shown` word → composition view uniform and finishing's, grey → finishing's, words →
readback. View whose exposure still moves redraws (`exposureMoving`, `frame/loop/unsettled.ts`).
View lit by no declared lamp shows albedo as is (`UNLIT_COMPOSITIONS`): no exposure, no curve. In
lit view `scene.background` is exposed like any pixel
([The background](the-display-finishing.md#the-display-finishing)).

**Adaptation runs on world time**: seconds the world lived between two images
(`createWorldFrames().clock`, `session/world/frames/frames.ts`; `EngineContext.worldClock`); with no
world (bench, test) own image clock (`WebgpuRun.graphClocks`). Physics `timeScale` and animation
banks' scales never reach it.

**Manual exposure** (`exposureMethod: 'manual'`). Camera EV100 comes from the physical camera settings
([Exposure settings](../sdk/canvas-camera-and-teardown/exposure-settings.md#exposure-settings)). White point = saturation
luminance × `2^EV100`; exposure = `2^exposureBias` × compensation-curve factor ÷ white point (curve
read at EV100 of white point ÷ middle grey ÷ saturation luminance).

No pass: CPU computes exposure (`manualExposure`, `packages/sdk-core/src/contracts/exposureManual.ts`), written into
meter exposure buffer only when changed (`ExposureMeter.hold`, `writeHeld`,
`post/exposure/meterRun.ts`).

- `writeHeld` writes only the changed range in one write. A held image copies only scale shown into
  view uniform (no `mapAsync`); readbacks are tagged with hold count, one in flight from before a
  hold is ignored. Meter knows exposure at once (`read.last`; `asked`, `local` set by hold).
- **Number** (`world.exposure = 0.5`): radiance × it; bias, curve, camera ignored. Multiplier `n` =
  manual with camera off and bias `log2(n)`, or fixed EV100 `−log2(n · saturation luminance)`.

**Lens attenuation** (`exposureLensAttenuation`). Luminance saturating sensor at
EV100 0 = `0.78 / lens attenuation` (`exposureSaturationLuminance`, 1 at default).

**Metering mask** (`exposureMeterMask`, `explorer.setExposureMeterMask(image)`, none default). Red
channel weighs where image is measured; 8-bit texture, bilinear. Histogram: read at corner of each
2 × 2 half-pixel quad (`quadWeight`); basic: once per grid texel.

**Local exposure middle grey** = 0.18 × exposure compensation (bias and compensation-curve factor at
frame mean) × 2^`localExposureMiddleGreyBias`, in exposure buffer `exposure[1].z` (log2). CPU writes
it for held (fixed: no bias, no curve; manual: cancels bias, keeps curve factor); finishing copies
it (`ExposureMeter.copyGrey`).

Options and examples: [Exposure settings](../sdk/canvas-camera-and-teardown/exposure-settings.md#exposure-settings).

**Pre-exposure** (`post/exposure/pre.ts`, `preExposureOf`; options `preExposure`,
`preExposureOverride`, `cachedLightingPreExposure`). Every light is written pre-multiplied by one
number, image pre-exposure = CPU-known exposure (`PreExposure.exposure`) × scene colour tint
luminance × local exposure mean gain (`averageLocalExposureOf`: mean over histogram buckets of log
local exposure gain; read back with exposure, `meterWgsl.ts`; 1 where local exposure does not run
and for manual); 1 for a view not lit, showing raw values or running no post (capture). Fixed once
per image (`beginPreExposure`), read from `preExposureOf`. Composition multiplies image by exposure
over it (`view.preExposure.y`, `meterWgsl.ts`).

- Writers apply it over `preExposed(rgb)` (`post/exposure/preWgsl.ts`) or, for a surface's final
  write, `preExposedClipped(rgb)`: term × pre-exposure first, colour then held to 32256. Writers:
  lit-image base pass (`lighting/deferred/colourPassWgsl.ts`), translucent layers
  (`blend/shader.ts`, `blend/transmission/transmitWgsl.ts`), particles
  (`particles/gpu/particlesWgsl.ts`), clouds (`modules/sky/clouds/traceWgsl.ts`, `composeWgsl.ts`), fog (`lighting/fog/fogPass.ts`), sky (`lighting/atmosphere/skyWgsl.ts`).
- Rescaled by pre-exposure ratio between images: temporal history (`historyRead`), fog volume cells,
  clouds' history (`sampleHistoryLight`), last lit image of reflections and screen probes
  (`ReflectionView.radiance.w`); previous kept (`PreExposure.previous`); temporal pass reads
  `pre.now / pre.previous`. Film and colour grading settings: `post/finish/settings.ts`.
- Histogram measures image ÷ it; local exposure, bloom, depth of field, light shafts use image ×
  exposure over it.

Sky light's real-time capture has own pre-exposure, one number whatever `preExposure`:
2^−`cachedLightingPreExposure` (`cachedPreExposure`,
`packages/sdk-core/src/contracts/exposureOptions.ts`). Faces written × it (sky held to 32256 per
channel); light colour (`skyLightColor`) × its inverse. Captured scene and specified cubemap:
written and read at 1.

**Exposure compensation curve** (`packages/sdk-core/src/contracts/exposureCurve.ts`, option
`exposureCurve` of session and `createWorld`, `explorer.setExposureCurve`; none = factor 1).
Stops added to exposure by scene brightness. Keys by EV100; linear, constant or cubic
between, extrapolated each side; baked into 64 half-float samples of `2^compensation` over EV100
-10 to +20 (`exposureCurveTable`, `meter.ts`). Update reads it at frame mean luminance, before range
holds it: `ev = log2(mean / 0.18)`, table place `(ev + 10) · 63 / 30` clamped, two neighbours mixed
(`post/exposure/curveWgsl.ts`), multiplies exposure bias by factor (`meterWgsl.ts`, `adapt`).

**Film curve** (`lighting/filmCurveWgsl.ts`, constants `filmCurveConstants.ts`): baked
into the tone table for `'filmic'`. Order: sRGB radiance → film wide gamut, saturated colour widening, blue correction,
glow and red pull by hue, first desaturation, per-channel curve (log luminance: slope 0.88, toe
0.55, shoulder 0.26, black clip 0, white clip 0.04), second desaturation, blue correction undone,
sRGB. Light the curve does not define shows black (`finiteValue`, `lighting/storableWgsl.ts`).
