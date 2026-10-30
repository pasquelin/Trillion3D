# The display finishing

Seven things follow the exposure's measure and come before the curve — the colour fringe at the read, the local
exposure, the tint, the bloom's glow, the vignette, the grain —, and the dither after it, in the lit image only (a view
lit by no declared lamp shows its albedo as it is, a diagnostic view and a capture the engine's image). The dither is
always drawn, so the composition of a lit image always carries the finishing's group (`post/finish/frame.ts`). The order
of a frame (`frame/render/surfaceLighting.ts`): the tone table's baking where a setting or the curve changed
(`post/finish/toneFrame.ts`) — first, before the transparents are bound, for the layers copy its words —, the lighting
and the transparents, the temporal resolve, the exposure (`post/exposure/`), the finishing's passes, the effect chain, the
composition. The previous camera of the view is kept once an image, at the lighting's start
(`frame/backend/state/previousCamera.ts`, `beginCamera`): the temporal pass, the sky light's occlusion and the horizon
occlusion each note the number of the image they last drew and read that camera only where it is the image before; a
history that skipped an image starts again, as after a cut.

**The scene's chain** (`post/filters/sceneChain.ts`) is the lit image brought to half size — one
bilinear read at the centre of each four pixels, their mean — and then a chain of levels, each the
mean of the 4 × 4 texels around the one above (`downsampleWgsl.ts`), half its size rounded up; a
level past the edge reads the last texel. The local exposure and the bloom share it: each asks the
levels it reads (`need`), each is drawn once.

**Bloom** (`post/effects/bloom/`, settings `packages/sdk-core/src/contracts/bloomOptions.ts`) is six
Gaussian blurs of the chain's levels, finest to widest, added up and added to the image — the glow adds
light: it conserves nothing. A level's blur is `size × sizeScale` percent of that level's width across
(`gaussianRadius`: half of it a radius), tinted by the level's tint and `intensity / 6`; the sizes are
0.3, 1, 2, 10, 30 and 64 percent times 4, the tints 0.3465, 0.138, 0.1176, 0.066, 0.066, 0.061, and
the intensity 0.675, so the glow is about 9 percent of the light. The blur is separable in two passes
(`filters/gaussianStage.ts`) with the Gaussian `exp(−16.7 (x / radius)²)` written for bilinear reads: two
neighbouring texels are one read, placed between them by their weights, at most 32 reads a pass, the
kernel cut at 31 texels (`gaussianKernel.ts`). From a radius of 7 texels the first pass writes half
the width, in the corner of its target, and the second reads it bilinearly. A read past the image is
zero (the sampler clamps; the shader scales a read by how far inside the image it was). From the
widest level to the finest each stage's second pass adds the stage below's output at its pixel, so
the finest stage's is the glow. With a threshold above −1 or a local exposure on, a setup pass
(`bloomWgsl.ts`) draws the half-size image with its local exposure applied and the pixels under the
threshold dimmed, and the bloom's own chain is built under it; otherwise the scene's levels are read as
they are. The blooms of a chain share their images (`bloomTargets.ts`) — they run one after the other —
and each glows from the image the chain was handed. The last bloom's glow is added by the
composition, where the exposure is applied; one before it adds its own to a target the next reads
(`composite`). Coverage is blurred with the colour, and the glow adds to it up to 1, so a glow over a
background shows over it.

**Local exposure** (`post/finish/`, settings `localExposure…` of `world.exposureSettings`,
`exposureOptions.ts`) splits each pixel's log luminance into a base layer, the light of its
neighbourhood, and a detail layer, what the pixel adds to it; it pulls the base toward middle grey by a
contrast scale — highlights above, shadows under — and keeps the detail by its strength, then moves
the pixel's light by the difference (`localGain`, `finishWgsl.ts`). The base is a mix of two
estimates. The bilateral grid (`localWgsl.ts`) is one compute pass over the half-size image: a
workgroup a tile of 64 × 64 pixels, each of its 64 threads sums the 8 × 8 block it reads into 32 bands
of log luminance, a pixel shared between the two bands it lies between, in fixed point; the grid's
cell is the band's sum of log luminance and its sum of weights (each a 64th, in half floats). The
grid is read trilinearly at the pixel's own luminance, so it follows edges; its ratio is the mean log
luminance of the pixels near it and as bright. The blurred luminance is the log2 luminance of the
chain's fifth level — 1/32 of the image —, Gaussian-blurred over `localExposureBlurSize` percent of its
width, mirrored at the edges, bilinearly read; `localExposureBlurBlend` (0.6) is its share, and the
only base where the grid holds no pixel. Middle grey is the local exposure's (above): 0.18 times the exposure
compensation and two to `localExposureMiddleGreyBias`. Thresholds keep the base's own
contrast within a distance of middle grey. The composition computes the gain per pixel from the
pixel's own luminance; the bloom's setup applies the same gain to the half-size image, so the glow is
the glow of what is shown. The settings of one view are
read at each image; a change draws it again (`finishMoving`).

**Vignette** (`SceneEnvironment.vignette`, `world.vignette`, 0.4) is the cosine-fourth law, `1 / (1 +
(v · r)²)²`, `r` the distance from the centre over a circle through the corners whatever the aspect:
it multiplies the image's light, the glow's included, after the exposure.

**Colour fringe, tint, sharpening.** The fringe reads the red and the green of a pixel nearer the image's centre than its
blue, by their wavelengths, in proportion to `chromaticAberration` percent of the distance to the centre
(`fringeTaps`, `finishWgsl.ts`); it is drawn only above 0.01, in a quality other than `'off'`, from
`chromaticAberrationStartOffset` out, capped by `chromaticAberrationMax`. The tint multiplies the scene's colour by
`sceneColorTintRed`, `Green` and `Blue` after the local exposure; the bloom's glow is not tinted. The sharpening is the
scene's `sharpness` (0 to 10) or `tonemapperSharpen` where that is 0 or more.

**Dither.** A triangular noise of one level of the display's channel added to the colour shown (`ditherOf`,
`finishWgsl.ts`): a hash of the pixel's place, moved by a Halton point of the image's number (modulo 8), gives `n` in
[−1, 1); the noise is `s − s · √(1 − |n|)`, `s` the sign of `n`, times the level. `quantizationDitheringBits` makes the level `1 / (2^bits − 1)`; 0 or less takes it from the target (1/255 for
an 8-bit one), 32 makes it too small to show. It is always drawn. Its pattern follows the image's number on every image
drawn; a view that rests, which is not drawn again, keeps the pattern of its last image — the held image is 8 bits, and a
new noise added to it would average, over the images, to the held image and not to the light (over eight images and 64
lights, 0.56 display levels of error against 0.16 for the image composed again from its light,
`post/finish/film.test.ts`); to draw every image at rest, as the reference does, open the session with
`drawConverged: true`.

**Film grain** multiplies the light, after the vignette and the glow, by `lerp(1, g, w)`: `g` is a texel of the grain's
texture — 128 × 128, `rgba8unorm`, generated once at the first image that draws the grain (`post/finish/grain.ts`) —
multiplied by `decode`, the texel count over the sum of the channel, so that its mean is 1; `w` is the strength times the
share of the pixel's zone: `1 − smoothstep(0, shadowsMax, l)` of the dark share, `smoothstep(highlightsMin,
highlightsMax, l)` of the bright, the rest the middle, `l` the exposed luminance read with the weights 0.0406, 0.7330,
−0.0316 (the matrix from the grading gamut to sRGB applied to that gamut's luminance row — an odd luminance, a blue pixel
reads as dark — kept as the reference computes it). The texture's coordinates are `uv · (1920 / 128, 1920 · h / w / 128) /
scale + (halton(i + 1, 2), halton(i + 1, 3))`, `i` the image's number modulo `filmGrainSequenceLength`, sampled bilinear
and repeated: a texel is one pixel of an image 1920 wide. The texture is generated to the reference grain's measured
statistics — the reference's own is an authored asset, which is not copied: per channel a mean of 0.5 and a spread of
0.070, 0.056 and 0.078, skewed toward the bright (0.5, 0.3, 0.6) with heavier tails than a bell; the three channels
following one another (0.62, 0.41, 0.54); texels following their neighbour at one texel's distance, each channel its own
way along each axis (0.20, 0.15, 0.20 along x and 0.06, 0.18, 0.30 along y: the scan's grain is streakier along one axis)
and none at two — by blurring a normal noise with a wrapping kernel on each axis, mixing it by the correlations' Cholesky
factor (each plane blurred for the share of the neighbour correlation a channel asks that the planes before it did not
give), bending it by the skew and the kurtosis and setting its mean and spread, from a seeded generator: the same texture
on every machine, repeating with no seam. At intensity 1 the grain changes a channel by 14, 11 and 15 percent of its
light, one standard deviation. A view whose grain is drawn is drawn again at each image, for its pattern follows the
image's number (`finishAnimated`, `frame/loop/hold.ts`).

**Quality.** `tonemapperQuality` (0 to 5) gates the vignette below 2 and the grain below 4; the quality levels write 0 at
`'smooth'`, 2 at `'balanced'` and 5 at `'fine'` and `'cinematic'`.

**One group, one pipeline.** The composition binds the finishing as group 1 (`finishLayout.ts`): the
uniform (`finishParams.ts`) — the vignette, the exposure copied on the GPU from the view's, the
luminance reading the exposure uses, the local exposure's settings —, the grid, the blurred luminance, a
sampler and the glow; a slot with nothing is an empty image, its flag in the uniform 0. The lit compositions bind the tone table, its sampler and its reading uniform after the as-is pixels' textures (bindings 4 to 6
with them, 2 to 4 without). A frame that can hold an as-is pixel (a row shown as-is, a diagnostic
view: `readsAsIs`) composes with the surfaces' flags and base colour (bindings 2 and 3,
`lighting/deferred/shaders.ts`): after the temporal pass and the chain, as a buffer is visualised,
the display pixel's render texel (`view.surface`, the surfaces' render pixels per display pixel) is
read unfiltered and, where it is as-is, its base colour is shown with the sRGB transfer alone, exact,
no dither — the transparents over it are not shown there, as no translucency is in the buffers a
visualisation reads; any other pixel gets the chain, bit for bit as a frame with none. The pipelines
that finish compile off the frame at the first image that asks (`composesFinish`); until then the image
is drawn plain and drawn again once they arrive. A frame's cost at 1920 × 1080 with all three on: 26
render passes and one compute pass beside the exposure's — the chain down to the fifth level (5), the
local exposure (1 compute, 3 render), the bloom's setup, chain and blurs (18) —, all but four of them
under 500 × 300 texels, and 22 MB of `rgba16float` targets; the composition reads three more textures
per pixel.

**The tone table.** The curve is not evaluated at each pixel. The composition reads, for the exposed light of a pixel,
the colour the display shows from a 3D table of `lutSize` texels a side (32 by default: 128 KiB, 256 KiB without the packed format), the way
the reference does (`lighting/toneLutRead.ts`): the light is addressed by the shaper — `log2(light) / 14 + 0.61` for the
logarithm, with a light of 0 on the first texel —, the table is read trilinearly at `code · (n − 1) / n + 0.5 / n`, and
the value is multiplied by the table's scale. A light of the curve `none` is shown as it is, through the transfer alone,
and the unlit view reads no table.

The table is baked by one compute pass of `n³` threads (`lighting/toneBakeWgsl.ts`, `toneLut.ts`), only when a colour
setting (`COLOR_GRADING_RULES`) or the rank of the scene's display curve differs from the last baking, and made again when
`lutSize` changes. Each texel is, in order: the light of its code (the shaper's inverse); the white balance, a 3 × 3 matrix
made on the processor (`lighting/whiteBalance.ts`: the white of the temperature on the daylight locus from 4000 K, the
black body's below, moved along its isotherm by the tint, adapted to the display's D65 by a von Kries scaling of
Bradford's cone responses); then, for the film curve: the expansion of a bright colour toward a wider gamut, the grade in
the film's working gamut (each zone's saturation, contrast, gamma, gain and offset over the whole light's, the three zones
weighed by the luminance), the blue correction, the glow and the red modifier, the curve of each channel (toe, straight
run, shoulder, blended where they overlap), the two desaturations, the curve's amount, the blue correction undone, then the
correction's polynomial and the power of the display's gamma ratio; for any other curve: the grade in the same gamut, then
the curve itself. Last the transfer — the sRGB curve, the power 1/2.4, or an explicit gamma (`tonemapperGamma` from 1 up;
0 keeps the transfer, and a number under 1 is read as 1: no transfer at all, the linear light as the display value) —,
divided by the table's scale, 1.05 for the film curve (its white clip lifts its output past 1) — except under an explicit
gamma and for the standard output transform, where it is 1 — and 1 for the other curves, and cut to [0, 1], as the
reference's table of unsigned integers cuts it. Each channel is held at ten bits, as the reference's table holds it: the table is
`rgb10a2unorm` where the device grants `texture-formats-tier1` (storage textures of that format, `toneTableFormat`), else
`rgba16float`, in which the baking itself rounds the value to a multiple of 1/1023 before it stores it, so that both hold the same
values (the half float's own rounding, a quarter of a step at most, apart).

**The cube is admitted by the device's memory budget** (`ledgerAdmitted`, `lighting/toneLut.ts` `tableKeeper`): its bytes
are known before it is made (`side³ × 4`, `× 8` in the half float), the cube it replaces is credited, and `lutSize` has no limit of its own but the
largest 3D texture the device makes. Where the room holds fewer texels the cube is the largest side the room holds
(`sideHolding`), not a refusal of the session, and the frame's metrics say so: `toneTable: { side, bytes, why }` (`why`
null when the cube is the size asked; `null` for the whole entry before a cube is made). Not even the least cube (2
texels a side) is optional — a lit image reads a table — so that one is made as any resource that cannot be left out,
outside the admission; the cube's bytes are part of the view's reserve (`effectTargets`, `frame/prepare/targetFunding.ts`).

Against the exact curve the 32-texel table differs, over lights from 0.002 to 45, by a fifth of one display level on
average and 0.4 at most on greys (the 64-texel table: a twentieth, 0.1); only a nearly pure saturated colour at the edge of
the display's gamut differs by more, up to 20 levels, where the exact curve is cut at 0 and the interpolation takes it from
its neighbours' — the reference's own behaviour with the same table. The table ends at an exposed light of 44.5 (the
logarithm's 14 stops): a brighter light reads the last texel, white for the film curve.

**What the table does with a light the curve does not define.** One guard the reference does not have, with its proof
(`lighting/filmCurveWgsl.ts`, `RRT_MEASURES_WGSL`): the square root of the glow's saturation measure is taken of a sum cut
at 0, which is never negative in exact arithmetic and a few units in the last place under 0 for a grey in single
precision. Nothing else is guarded: a black light's logarithm and its chroma divide by nothing, and the value that is not
a number comes out as 0, as the reference's unsigned targets turn it, in the table (`storable`,
`lighting/storableWgsl.ts`: a value that is not a number is 0, +infinity 1, then cut to [0, 1]) and on the path that reads
no table (`displayValue`, `finiteValue`: the same cut on the display value); the float table is read trilinearly, so one
NaN texel would poison the cell around it. A consequence: an exact black light stays black under a colour offset, as the
reference's table shows it. The grade's and the grain's parts are weighed by one smooth step of any order of its edges
(`hermite`, `gpu/core/smoothstepEdges.ts`): `saturate((x − a) / (b − a))`, then `t² (3 − 2t)` — a reversed ramp where the
top is under the start, a step where they are equal —, where WGSL's own `smoothstep` is undefined.

**The layers drawn on display values.** A translucent layer that filters the display (multiply, subtractive, and the
normal and additive ones where a filter surface covers the pixel) and a particle drawn over one map their colour in
display space, as the composition shows it. Their fragment stage has no sampled texture to spare
(`gpu/core/stageLimits.test.ts`: 16 of 16), so they do not read the table: the view carries a copy of the baking's words
(`BAKE_LAYOUT`, 124 words: in the blend view uniform and in each pool's draw words) and the layer runs the baking's chain
on them (`displayLight`, `lighting/toneBakeWgsl.ts`) — the same white balance, grade, curve or method and transfer as the
table, with no texture —, then multiplies by the table's scale. The table is baked, and its words written, before the
transparents are bound (`frame/render/surfaceLighting.ts`). An unlit layer is shown as it is.

**The standard output transform** (`tonemappingMethod: 'standardAces'`, `lighting/aces/`). In the film curve's place, after
the white balance, the expansion of the gamut and the grade, the light in the grading gamut is cut to [0, 100] — the range
the table's quantizer reads, by the caller (`displayLight`) for both versions — and multiplied by
`acesSceneColorMultiplier`; then, by `acesVersion`:

- **Version 2** (the default). The light is taken to XYZ and to the lightness `J`, colourfulness `M` and hue `h` of a
  colour appearance model under the light's viewing condition (a white of 100 nits, a background of 20, a dim surround:
  `acesCam.ts`); its luminance put through the tone scale (a curve of the scene-referred light with a flare toe, fitted so
  that 18 % grey is 10 nits of a 100-nit display and a light of 128 reaches the peak) and back to a lightness; its
  colourfulness compressed with the lightness (expanded where small by a toe run backwards from the gamut's reach,
  compressed toward it above, normalised by a function of the hue); the colour pulled into the display's gamut along the
  line of constant hue that leaves the cusp's lightness for the focus, rolled off between the gamut's edge — a smooth
  minimum of its lower and upper faces, the upper one a curve whose exponent is read from a table by hue — and the reach of
  the grading gamut (`acesHull.ts` holds the numbers); then taken back to sRGB's primaries and cut to [0, 1]
  (`acesWgsl.ts`). The three hue tables — the grading gamut's reach, the display gamut's cusp and the curvature of its
  upper face — are constants of the one display the engine has (sRGB's gamut, a peak of 100 nits, no HDR) and are written
  as numbers (`acesTables.ts`), which a test holds to the ones made from the gamut by the search the transform specifies
  (`acesTables.fixture.ts`). The model on the processor, in double precision, is the tests' oracle, not the engine's
  (`acesModel.fixture.ts`, `acesGamutModel.fixture.ts`; `aces/acesDisplay.test.ts` holds the shader to it to 1.5e-7).
- **Version 1** (`acesVersion: 1`, `aces13Wgsl.ts`), the earlier rendering and output transforms of the film industry's
  colour system, version 1.3, in its own order and numbers, on the three channels. The light times the multiplier is taken
  to the colour encoding's primaries; the gamut compression (`acesGamutCompression`, 0 by default, from 0 to 1) is mixed
  in by its share — each channel's distance from the largest is compressed past a threshold toward a limit (cyan 1.147,
  magenta 1.264, yellow 1.312; thresholds 0.815, 0.803, 0.88; power 1.2), a colour with a negative channel left as it is
  —; the rendering's sweeteners follow: a glow on dark saturated colours, a pull of the reds toward a pivot by a cubic
  spline of the hue 135 degrees wide, the colour taken to the rendering primaries and desaturated by 0.96; the tone scale
  on each channel (a quadratic spline through three points in the logarithms of the light and of the luminance, flat at
  both ends); the luminance taken to a share of the display's range, through XYZ and the display primaries' limit, back
  to nits; to sRGB's primaries by the adaptation of the colour encoding's white to sRGB's; a hundredth; cut to [0, 1]. The
  tone scale is the one the reference configures for a high-range display — 10⁻⁴, 15 and 1000 nits, written as numbers
  (`SCALE`, `aces13Wgsl.ts`) which the model derives from the three luminances (`scaleOf`, `aces13Model.fixture.ts`) — and
  the reference never reconfigures it for a display of 100 nits, so **on an sRGB display the 1000-nit curve is cut at the
  100 nits the display shows, and the picture is much brighter than version 2's**: a neutral light of 0.18, times the
  multiplier 1.5, is shown 0.255 in linear display light against version 2's 0.157, a light of 0.5 0.81 against 0.38, a
  light of 1 is white. The display's luminances are not options: they only matter with an HDR output, which the engine does
  not have. The glow's measures are the film curve's (`RRT_MEASURES_WGSL`). The shader is held, run in JavaScript, to the
  model written from the published matrices and steps (`aces/aces13.test.ts`), and to values worked by hand from them: the
  light the scale puts at its middle point (0.0822144598) shows 0.047999, the slope there is the scale's 1.55, the red
  modifier's weight is 1 at the red.

The default transfer after either version is the power 2.4 (`sdrInverseEotf: 'default'`) and the table's scale 1. The
reference bakes the transform into a second 64-texel table addressed by the quantizer and reads it from the outer one;
ours evaluates it for each texel of the outer table — the same function without the second table's interpolation — so
the layers, which cannot read a table, run the very same function. At `acesSceneColorMultiplier` 1.5 and no other
setting, version 2 shows 18 % grey 118 of 255, as the film curve does, a light of 1 201 against the film curve's 221, a
light of 4 238 against 249.

**The background.** In a lit view the flat `scene.background` colour is scene radiance, not a display colour drawn as it is:
the colour pass writes it into the lit image where no surface drew (`surfaceColourMain`, `lighting/deferred/colourPassWgsl.ts`) as
`srgbToLinear(colour)`, multiplied by the image's pre-exposure like every light, with an alpha of 1 (nothing of the background hidden) — so exposure, the display
curve, the grade and the temporal resolve treat it as any pixel, and **a white background is no longer pure white**: it
is the radiance of 1, shown as a light of 1 is. With a fog and no atmosphere the pixel is the fog's inscattering plus the
background through its transmittance (the fog pass lays it over the colour); a raw diagnostic view shows it as every pixel of its image, as radiance. A ray that
leaves the scene and meets no sky reaches the same radiance (`createSurroundings`, `lighting/reflections/surroundings.ts`:
the colour's `srgbToLinear`, made again only when the colour changes, no exposure division), so a mirror adds what the
screen holds. The sky, where there is one, is drawn over it.

**The alpha channel.** The lit image carries an alpha channel (`propagateAlpha`, a film setting, off by default), and no
stage weighs a colour by it: the exposure meter, the local exposure, the grain and the composition read the colour as it
is. Off, the alpha is read by nothing and the image shown is opaque (`composeAt`, `lighting/deferred/shaders.ts`). On, it is
the share of the background the image leaves visible, an inverse opacity — 1 where nothing is drawn, 0 on a surface —, carried
to the image a capture holds: the colour pass writes 1 where no surface drew and 0 on every surface, the sky multiplies
it by what it lets through (nothing, where it draws), the fog, the clouds and the haze by their transmittance
(`lighting/fog/fogPass.ts`, `modules/sky/clouds/compose.ts`, `lighting/atmosphere/`), the translucent layers by their
transmittance and by the mean of the modulation's channels (`layersOver`); the temporal pass, the depth of field and the
bloom's glow keep it as it is, and the display's last link writes it beside the tonemapped colour. The subsurface
scattering gathers the diffuse light's luminance in it between the lighting and the recombine, which writes 0 back.

**The alpha holdout** (`primitiveAlphaHoldout`, with `propagateAlpha`, off by default; `blend/holdout*.ts`). With it on,
the translucent layers are drawn once more, from far to near, into a target of their own (`encodeHoldout`, once every set of
layers is drawn): it starts as the lit image's alpha in red, green and blue and 1 in its alpha (`holdoutStart`), and each
layer lays its output over it, `visibility = add + visibility · through`, `throughput = throughput · through`
(`HOLDOUT_TARGET`): a blend or thin-translucent layer lets `1 − opacity` through and adds nothing, a layer of blending
`'alphaHoldout'` adds its opacity as well, a layer that multiplies the scene lets `1 − opacity` through behind the fog's
transmittance squared, an additive layer touches neither, a layer that covers lets nothing through; the fog in front scales what a
layer adds by its transmittance and, where the height fog holds out, adds its own coverage of the layer's
(`fsBlendHoldout`, `fsTransmitHoldout`, `holdoutOut`). The visibility it ends with replaces the lit image's alpha
(`applyHoldout`) before the depth of field (`'beforeDepthOfField'`, the default) or, only where a layer left something, after
it (`'afterDepthOfField'`, `applyPendingHoldout`). The composition of the layers leaves the alpha as it is then: the
modulation target is cleared to an alpha of 1 (`MODULATION_KEEPS_ALPHA`). The sky holds out by drawing black, its alpha the
coverage of its air, with a blend that lays the coverage on the image's alpha (`SceneAtmosphere.holdout`; the haze adds no light
but dims), the height fog by adding none and the same blend (`SceneHeightFog.holdout`), the clouds by their `alphaHole` setting and
a composition that lays their coverage the same way (the cloud view-mode 3 only). The single-layer water is an opaque surface
for the alpha (alpha 0, or black with alpha 1 when held out). The object's `holdout` switch (`FLAG_HOLDOUT`, `PLACEMENT_HOLDOUT`)
makes its pixels black with an alpha of 1 and no surface record. With the support off, `propagateAlpha` alone makes a surface of
blending `'alphaHoldout'` raise the alpha as the standard blend does, the particles with it; with the support on the particles add
nothing to the accumulation.

**Agent tools.** `trillion3d_set_film` sets the 32 film settings, `trillion3d_set_color_grading` the 107 colour settings (the grade's eighty have a description of 60 characters or fewer, the meaning of each operation said once, in the tool's text: `llm/colorGradingMeanings.ts`), `trillion3d_set_ambient_occlusion` the occlusion's; their texts name each setting with its default, bounds and meaning, from the rules.
