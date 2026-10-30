# The display finishing

Six effects follow the exposure measure, before the curve (colour fringe at read, local exposure,
tint, bloom glow, vignette, grain); dither follows the curve. Lit image only (a view with no declared lamp
shows albedo). Dither is always drawn: lit compositions carry the finishing group
(`post/finish/frame.ts`). Frame order (`frame/render/surfaceLighting.ts`): tone baking if a setting or
the curve changed (`post/finish/toneFrame.ts`; before transparents bind), lighting and
transparents, temporal resolve, exposure (`post/exposure/`), finishing passes, effect chain,
composition. Previous camera kept once an image
(`frame/backend/state/previousCamera.ts`, `beginCamera`); temporal pass, sky light and horizon
occlusion restart their history if it is not the image before.

## The scene's chain

Code `post/filters/sceneChain.ts`. Lit image at half size, then levels, each the
mean of the 4 × 4 texels around the one above (`downsampleWgsl.ts`), half size rounded up; past-edge
reads take the last texel. Local exposure and bloom share it (`need`).

## Bloom

Code `post/effects/bloom/`, settings `packages/sdk-core/src/contracts/bloomOptions.ts`. Six
Gaussian blurs of chain levels, finest to widest, summed, added to the image. Level blur = `size ×
sizeScale` percent of level width across (`gaussianRadius`: half is a radius), tinted by level tint and
`intensity / 6`; sizes 0.3, 1, 2, 10, 30, 64 percent times 4, tints 0.3465, 0.138, 0.1176, 0.066,
0.066, 0.061, intensity 0.675: glow about 9 percent of light.

- Separable blur, two passes (`filters/gaussianStage.ts`), Gaussian `exp(−16.7 (x / radius)²)`, at most
  32 reads a pass, kernel cut at 31 texels (`gaussianKernel.ts`). From radius 7 texels the first pass
  writes half width. Past-image reads zero.
- Widest to finest, each stage's second pass adds the stage below's output; finest = glow.
- Threshold above −1 or local exposure on: setup pass (`bloomWgsl.ts`) draws half-size image with local
  exposure applied and sub-threshold pixels dimmed; bloom's own chain built under it. Else scene levels.
- Chain's blooms share images (`bloomTargets.ts`). Last bloom's glow added by composition; earlier
  ones add theirs to a target the next reads (`composite`).
- Coverage blurred with colour; glow adds to it up to 1.

## Local exposure

Code `post/finish/`, settings `localExposure…` of `world.exposureSettings`,
`exposureOptions.ts`. Splits pixel log luminance into base and detail. Pulls base toward middle grey
by contrast scale (highlights above, shadows under), keeps detail by strength, moves pixel light by the
difference (`localGain`, `finishWgsl.ts`). Base mixes two estimates:

- Bilateral grid (`localWgsl.ts`): one compute pass over half-size image, workgroup per 64 × 64 tile,
  each thread sums an 8 × 8 block into 32 log-luminance bands (pixel shared between two bands), fixed
  point; cell = sum of log luminance + sum of weights; read trilinearly at pixel luminance.
- Blurred luminance: log2 luminance of chain level 5 (1/32 of image), Gaussian-blurred over
  `localExposureBlurSize` percent of its width, mirrored edges; share `localExposureBlurBlend` (0.6);
  only base where grid holds no pixel.

Middle grey = 0.18 × exposure compensation × two to `localExposureMiddleGreyBias`. Composition
computes gain per pixel; bloom setup applies it to the half-size image. A change redraws
(`finishMoving`).

## Vignette

Set by `SceneEnvironment.vignette`, `world.vignette` (0.4). Cosine-fourth law, `1 / (1 +
(v · r)²)²`, `r` = distance from centre over a circle through the corners. Multiplies image light, glow
included, after exposure.

## Colour fringe, tint, sharpening

Fringe reads red and green nearer image centre than blue,
proportional to `chromaticAberration` percent of distance to centre (`fringeTaps`, `finishWgsl.ts`);
drawn only above 0.01, quality other than `'off'`, from `chromaticAberrationStartOffset` out, capped by
`chromaticAberrationMax`. Tint multiplies scene colour by `sceneColorTintRed`, `Green`, `Blue` after
local exposure; glow untinted. Sharpening = scene `sharpness` (0 to 10) or `tonemapperSharpen` where
that is 0 or more.

## Dither

Triangular noise of one display-channel level added to shown colour (`ditherOf`,
`finishWgsl.ts`): pixel hash moved by a Halton point of image number (modulo 8) gives `n` in [−1, 1);
noise `s − s · √(1 − |n|)`, `s` = sign of `n`, times level. `quantizationDitheringBits` sets level
`1 / (2^bits − 1)`; 0 or less takes it from target (1/255 for 8-bit), 32 makes it invisible. A resting
view keeps its last pattern; to draw every image at rest, open the session with `drawConverged: true`.

## Film grain

Grain multiplies light, after vignette and glow, by `lerp(1, g, w)`. `g` = texel of grain
texture (128 × 128, `rgba8unorm`, generated once, `post/finish/grain.ts`) times `decode` (texel count
over channel sum; mean 1). `w` = strength times pixel zone share: `1 − smoothstep(0, shadowsMax, l)`
dark, `smoothstep(highlightsMin, highlightsMax, l)` bright, rest middle; `l` = exposed luminance with
weights 0.0406, 0.7330, −0.0316. Texture coordinates `uv · (1920 / 128, 1920 · h / w / 128) / scale +
(halton(i + 1, 2), halton(i + 1, 3))`, `i` = image number modulo `filmGrainSequenceLength`, bilinear,
repeated; a texel = one pixel of a 1920-wide image.

Grain texture, per channel: mean 0.5, spread 0.070, 0.056, 0.078, skew (0.5,
0.3, 0.6); channel correlations 0.62, 0.41, 0.54; neighbour correlation at one texel (0.20, 0.15, 0.20
along x; 0.06, 0.18, 0.30 along y). At intensity 1 grain changes a channel by 14, 11, 15 percent of
its light. A view drawing grain redraws each image (`finishAnimated`, `frame/loop/hold.ts`).

## Quality

`tonemapperQuality` (0 to 5) gates vignette below 2 and grain below 4; its levels:
[Effect chain, bloom and film effects](../sdk/canvas-camera-and-teardown/effect-chain-bloom-and-film-effects.md#effect-chain-bloom-and-film-effects).

## One group, one pipeline

Composition binds finishing as group 1 (`finishLayout.ts`): uniform
(`finishParams.ts`), grid, blurred luminance, sampler, glow; empty slot = empty image, uniform flag 0.
Lit compositions bind tone table, sampler and reading uniform (bindings 4 to 6 with as-is textures,
2 to 4 without). A frame that can hold an as-is pixel (row shown as-is,
diagnostic view: `readsAsIs`) composes with surfaces' flags and base colour (bindings 2 and 3,
`lighting/deferred/shaders.ts`): an as-is pixel shows base colour with sRGB transfer alone, no dither,
transparents over it not shown. Finishing pipelines compile off-frame (`composesFinish`); until then
image drawn plain.

## The tone table

Composition reads the display colour for a pixel's exposed light from a 3D table of
`lutSize` texels a side (32 default: 128 KiB, 256 KiB without packed format;
`lighting/toneLutRead.ts`): light addressed by shaper (`log2(light) / 14 + 0.61`, light 0 on first
texel), read trilinearly at `code · (n − 1) / n + 0.5 / n`, value times table scale. Curve `none` shows
light as is via transfer alone; unlit view reads no table.

Baked by one compute pass of `n³` threads (`lighting/toneBakeWgsl.ts`, `toneLut.ts`) only when a colour
setting (`COLOR_GRADING_RULES`) or the scene display curve's rank changed, or `lutSize` changed. Per
texel, in order:

1. light of its code (shaper inverse);
2. white balance, 3 × 3 matrix made on CPU (`lighting/whiteBalance.ts`: temperature's white on daylight
   locus from 4000 K, black body's below, moved along its isotherm by tint, Bradford adaptation to
   display D65);
3. film curve: gamut expansion, grade in film working gamut (three luminance zones, each with
   saturation, contrast, gamma, gain, offset), blue correction, glow and red modifier, per-channel
   curve (toe, straight run, shoulder), desaturations, correction polynomial; other curve: grade in
   same gamut, then the curve;
4. transfer (sRGB curve, or explicit gamma: `tonemapperGamma` from 1 up; 0 keeps transfer; under 1 read
   as 1: no transfer), divided by table scale: 1.05 for film curve except under explicit gamma and the
   standard output transform (1); 1 for other curves; cut to [0, 1].

Each channel held at ten bits: `rgb10a2unorm` where device grants `texture-formats-tier1`
(`toneTableFormat`), else `rgba16float` rounded to multiples of 1/1023.

## The cube is admitted by the device memory budget

Code `ledgerAdmitted`, `lighting/toneLut.ts` `tableKeeper`. Bytes `side³ × 4` (`× 8` half float), replaced cube credited; `lutSize` limited by
device's largest 3D texture. If room holds fewer texels the cube is the largest side it holds
(`sideHolding`), no refusal; frame metrics: `toneTable: { side, bytes, why }` (`why` null when size as
asked; `null` entry before any cube). The least cube (2 texels a side) is required, outside admission;
bytes are part of the view's reserve (`effectTargets`, `frame/prepare/targetFunding.ts`).

32-texel table error vs exact curve: 0.2 display level on average, 0.4 at most on greys (64-texel:
0.05, 0.1); saturated colour at display gamut edge up to 20 levels. Table ends at exposed light 44.5.

## Undefined lights

Glow saturation measure takes the square root of a sum cut at 0
(`lighting/filmCurveWgsl.ts`, `RRT_MEASURES_WGSL`). NaN comes out 0, in the table (`storable`,
`lighting/storableWgsl.ts`: NaN 0, +infinity 1, then cut to [0, 1]) and on the no-table path
(`displayValue`, `finiteValue`). Grade and grain weights use one smooth step for any edge order (`hermite`, `gpu/core/smoothstepEdges.ts`):
`saturate((x − a) / (b − a))`, then `t² (3 − 2t)` (reversed ramp if top under start).

## The layers drawn on display values

Translucent layers filtering the display (multiply,
subtractive, and normal/additive where a filter surface covers the pixel) and particles read no table
(`gpu/core/stageLimits.test.ts`: 16 of 16 textures); the view carries a copy of baking words
(`BAKE_LAYOUT`, 124 words) and the layer runs the baking chain on them (`displayLight`,
`lighting/toneBakeWgsl.ts`), times table scale. Unlit layers shown as is.

## The standard output transform

`tonemappingMethod: 'standardAces'`, `lighting/aces/`. Replaces the
film curve after white balance, gamut expansion, grade: light in grading gamut cut to [0, 100], times
`acesSceneColorMultiplier`; then by `acesVersion`:

- **Version 2** (default). Colour appearance model (white 100 nits, background 20, dim
  surround: `acesCam.ts`); tone scale (18 % grey = 10 nits, light 128 reaches peak); colour pulled into display gamut along constant-hue line (`acesHull.ts`); sRGB primaries, cut
  to [0, 1] (`acesWgsl.ts`). Three hue tables are constants for sRGB gamut, peak 100 nits, no HDR
  (`acesTables.ts`, `acesTables.fixture.ts`). CPU oracle: `acesModel.fixture.ts`,
  `acesGamutModel.fixture.ts`; `aces/acesDisplay.test.ts`.
- **Version 1** (`acesVersion: 1`, `aces13Wgsl.ts`): ACES 1.3 transforms, per channel. Gamut
  compression (`acesGamutCompression`, 0 default, 0 to 1): limits cyan 1.147, magenta 1.264, yellow
  1.312; thresholds 0.815, 0.803, 0.88; power 1.2; colour with a negative channel left as is. Tone
  scale = reference's high-range display configuration (10⁻⁴, 15 and 1000 nits, `SCALE`, `scaleOf`,
  `aces13Model.fixture.ts`), so **on an sRGB display the 1000-nit curve is cut at 100 nits, picture
  much brighter than version 2's**: neutral light 0.18 times multiplier 1.5
  shows 0.255 linear display light vs version 2's 0.157, light 0.5 shows 0.81 vs 0.38, light 1 is
  white. Glow measures = film curve's (`RRT_MEASURES_WGSL`). Test: `aces/aces13.test.ts`.

Default transfer after either version: power 2.4 (`sdrInverseEotf: 'default'`), table scale 1. At
`acesSceneColorMultiplier` 1.5, version 2 shows 18 % grey 118 of 255 (as film curve), light 1 201 (film
221), light 4 238 (249).

## The background

In a lit view flat `scene.background` colour is scene radiance: the colour pass
writes it where no surface drew (`surfaceColourMain`, `lighting/deferred/colourPassWgsl.ts`) as
`srgbToLinear(colour)`, times image pre-exposure, alpha 1. Exposure, curve, grade and temporal resolve
treat it as any pixel: **a white background is radiance 1, shown as light 1 is**. Fog without
atmosphere: pixel = fog inscattering + background through its transmittance. A ray meeting no sky
reaches the same radiance (`createSurroundings`, `lighting/reflections/surroundings.ts`; no exposure
division). Any sky is drawn over it.

## The alpha channel

Lit image carries alpha (`propagateAlpha`, a film setting, off by default); no
stage weighs colour by it. Off: shown image opaque (`composeAt`, `lighting/deferred/shaders.ts`). On:
share of background left visible (1 where nothing drawn, 0 on a surface), carried to the captured
image:

- colour pass writes 1 where no surface drew, 0 on every surface;
- sky multiplies by what it lets through (nothing where it draws), fog, clouds, haze by their
  transmittance (`lighting/fog/fogPass.ts`, `modules/sky/clouds/compose.ts`, `lighting/atmosphere/`),
  translucent layers by their transmittance and the mean of the modulation's channels (`layersOver`);
- temporal pass, depth of field, bloom glow keep it; display's last link writes it beside the colour;
- subsurface scattering gathers diffuse light luminance in it between lighting and recombine, which
  writes 0 back.

## The alpha holdout

Setting `primitiveAlphaHoldout`, with `propagateAlpha`, off by default; `blend/holdout*.ts`. On: translucent layers drawn once more, far to near, into their own target
(`encodeHoldout`): starts as lit image alpha in red, green, blue, 1 in alpha (`holdoutStart`); each
layer lays its output over it, `visibility = add + visibility · through`,
`throughput = throughput · through` (`HOLDOUT_TARGET`):

- blend or thin-translucent layer: `1 − opacity` through, adds nothing;
- blending `'alphaHoldout'`: also adds its opacity;
- scene-multiplying layer: `1 − opacity` through behind fog transmittance squared;
- additive layer touches neither; covering layer lets nothing through;
- fog in front scales what a layer adds by its transmittance and, where height fog holds out, adds its
  coverage (`fsBlendHoldout`, `fsTransmitHoldout`, `holdoutOut`).

Final visibility replaces lit image alpha (`applyHoldout`) before depth of field
(`'beforeDepthOfField'`, default) or, only where a layer left something, after (`'afterDepthOfField'`,
`applyPendingHoldout`); layer composition leaves alpha as is (`MODULATION_KEEPS_ALPHA`). Sky holds out
by drawing black, alpha = coverage of its air (`SceneAtmosphere.holdout`); height fog by adding none
(`SceneHeightFog.holdout`); clouds by `alphaHole` (cloud view-mode 3 only). Single-layer water =
opaque surface for alpha. Object `holdout` switch (`FLAG_HOLDOUT`, `PLACEMENT_HOLDOUT`): pixels
black, alpha 1, no surface record. Support off: `'alphaHoldout'` surface raises alpha as standard
blend does; support on: particles add nothing to the accumulation.

## Agent tools

`trillion3d_set_film` sets the 32 film settings, `trillion3d_set_color_grading` the 107
colour settings (`llm/colorGradingMeanings.ts`), `trillion3d_set_ambient_occlusion` the occlusion's.
