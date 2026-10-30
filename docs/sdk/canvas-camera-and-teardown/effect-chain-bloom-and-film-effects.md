# Effect chain, bloom and film effects

`world.effects` is the ordered chain of passes after temporal antialiasing, before the canvas.
`world.effects.add(pass, index?)`, `remove(pass)` and `clear()` change the chain; settings show next
frame. An empty chain costs nothing; a still image is post-processed once.

## Bloom, vignette and local exposure

A world starts with a bloom in its chain, `effect.bloom()` at its defaults: six Gaussian blurs of the
linear image at six scales, added to it before the exposure and the curve, in a view lit by declared
lamps, about 9 percent of the light at the default `intensity` of `0.675`. Remove it
(`world.effects.clear()`) or set its `intensity` to 0 for an image without.

`effect.bloom({ intensity,
threshold, sizeScale, levels })`: `threshold` (`-1` by default, every pixel glows) is the exposed
luminance past which a pixel glows.

- `sizeScale` (`4`): the multiplier of every level's width.
- `levels`: the six levels' `{ size, tint }`, finest first. `size` is a percent of the level's width
  (`0.3`, `1`, `2`, `10`, `30`, `64`; 0 leaves the level out); `tint` is a number or `[r, g, b]`
  (`0.3465`, `0.138`, `0.1176`, `0.066`, `0.066`, `0.061`).

`world.vignette` (`0.4`; 0 none) darkens the lit image toward its corners. The local exposure, in
`world.exposureSettings`, brings each pixel's light nearer to middle grey by how far the light around
it is from it: `localExposureHighlightContrast` and `localExposureShadowContrast` (`0.8`),
`localExposureDetailStrength` (`1`), `localExposureBlurBlend` (`0.6`), `localExposureBlurSize` (`50`),
`localExposureMiddleGreyBias` (`0`), the two thresholds (`0`) and their strengths (`1`). It is on by
default, as in a new project; `1` for both contrasts with a detail of `1` turns it off.

```js
const [bloom] = world.effects.passes // the bloom the world started with
bloom.intensity = 0.3 // a fainter glow; 0 turns it off, `world.effects.clear()` removes it
world.vignette = 0.2 // a lighter vignette; 0 none
world.exposureSettings = { localExposureHighlightContrast: 1, localExposureShadowContrast: 1 } // local exposure off
```

## Film effects

The lit image of a view is finished with the effects of a lens and a film, after the exposure and
before the curve. `world.vignette` (`0.4`) is the strength of the vignette; the rest of its look, and
the other effects, are the run-time settings `world.film`, also options of `createWorld`, and
`explorer.setFilm(field, value)` on a session; an agent sets them through `trillion3d_set_film`. Each
has the reference's default, so with nothing written the vignette and the dither are on and the
grain, the colour fringe and the tint are off. A write applies from the next frame; `null` gives a
setting back to its default or to the quality level's. The effects draw in the lit image only: a view
that shows the albedo, a diagnostic view and a capture show the image as it is.

| Setting | Default | Meaning |
| --- | --- | --- |
| `filmGrainIntensity` | `0` | The film grain's strength; 0 draws none. The grain multiplies the exposed light by a noise of mean 1, so the image keeps its average brightness. |
| `filmGrainIntensityShadows`, `filmGrainIntensityMidtones`, `filmGrainIntensityHighlights` | `1` each | The share of the grain in the dark, middle and bright pixels; all three at 0 draw none. |
| `filmGrainShadowsMax` | `0.09` | The luminance up to which a pixel is dark: the dark share fades out to nothing there. |
| `filmGrainHighlightsMin`, `filmGrainHighlightsMax` | `0.5`, `1` | The luminances from which a pixel starts to be bright and from which it is wholly so. |
| `filmGrainScaleX`, `filmGrainScaleY` | `1` | The size of a grain along each axis: 1 is a texel of one pixel on an image 1920 wide, and the grain grows with the image. |
| `filmGrainSequenceLength` | `97` | The images after which the grain's pattern repeats. |
| `chromaticAberration` | `0` | The colour fringe's intensity, in percent of the distance to the centre. The red and the green of a pixel are read nearer the centre than its blue, by their wavelengths. 0.01 or less draws nothing. |
| `chromaticAberrationStartOffset` | `0` | The distance from the centre, 0 to 1, where the fringe starts; 1 draws nothing. |
| `chromaticAberrationQuality` | `'high'` | `'off'` draws no fringe whatever its intensity. |
| `chromaticAberrationMax` | `-1` | −1 leaves the intensity as it is, 0 or more caps it there, −2 forces an extreme one (5). |
| `vignetteType` | `'cosineFourthLaw'` | The shape: the cosine-fourth law of a lens, or `'oval'`. |
| `vignetteColorRed`, `vignetteColorGreen`, `vignetteColorBlue` | `0` | The colour the image darkens toward (black). |
| `vignetteCenterX`, `vignetteCenterY` | `0.5` | Where it is brightest; 0.5 is the middle. |
| `vignetteSizeX`, `vignetteSizeY`, `vignetteSoftness` | `1`, `1`, `5` | The oval's extent and how fast it falls to the colour. |
| `tonemapperQuality` | `5` | 0 to 5: under 2 the vignette is off, under 4 the grain is. The quality levels write 0 at `'smooth'`, 2 at `'balanced'` and 5 at `'fine'` and `'cinematic'`. |
| `tonemapperSharpen` | `-1` | Below 0 the scene's `sharpness`; 0 or more replaces it. Both are read from 0 to 10. |
| `sceneColorTintRed`, `sceneColorTintGreen`, `sceneColorTintBlue` | `1` | The tint the scene's colour is multiplied by; the bloom's glow is not tinted. |
| `quantizationDitheringBits` | `0` | The dither that hides the display's steps: a triangular noise of one level of the display's channel added to the colour shown, always drawn, with a new pattern at each image drawn. 0 or less takes the step from the target (1/255 for an 8-bit one); a number of bits, any whole number, makes it 1/(2^bits − 1), 32 too small to show. |
| `propagateAlpha` | `false` | Whether the image carries an alpha channel. Off, the colour is shown opaque and the alpha is read by nothing. On, the alpha is the share of the background the image leaves visible, an inverse opacity: 1 where nothing is drawn, 0 on a surface, multiplied by the transmittance of the sky, the fog, the clouds and the translucent layers; the post stages read the colour as it is and carry the alpha beside it, and a capture holds it. |
| `primitiveAlphaHoldout` | `false` | Whether the engine supports the alpha holdout. It takes effect only with `propagateAlpha` on: the translucent layers are then drawn once more, far to near, to accumulate the share of the background they leave visible, which replaces the image's alpha, so a layer of blending `'alphaHoldout'`, or a sky, clouds or height fog that holds out (`holdout`), punches a hole in it. |
| `translucencyHoldoutLocation` | `'beforeDepthOfField'` | Where the accumulated alpha is laid over the image: `'beforeDepthOfField'`, with the translucent layers, or `'afterDepthOfField'`, only where a layer left something, once the depth of field has drawn. |

```js
world.film = { filmGrainIntensity: 0.3, filmGrainScaleX: 1.5, filmGrainScaleY: 1.5 } // a coarser grain
world.film = { chromaticAberration: 2, chromaticAberrationStartOffset: 0.3 } // a fringe from a third of the way out
world.film = {
  vignetteType: 'oval',
  vignetteSizeX: 1.4,
  vignetteSoftness: 3,
  vignetteColorBlue: 0.04,
}
world.film = { tonemapperSharpen: 1 } // sharpen whatever the scene says; `null` gives the scene's back
world.film = { quantizationDitheringBits: 32 } // no visible dither: bit-exact captures
world.film = { propagateAlpha: true } // a capture carries the share of the background left visible (1 − opacity) in its alpha, for compositing
world.film = { propagateAlpha: true, primitiveAlphaHoldout: true } // holes in the alpha where a layer, the sky, the clouds or the fog hold out
const world = await createWorld(canvas, { filmGrainIntensity: 0.3 }) // as an option
```

The scene's own `sharpness` (the `environment` of the scene) is read from 0, none, to 10; 1 is a
unit-gain sharpening and 0, the default, draws none. The dither is on by default: at one level of an
8-bit display, 1/255, its noise changes no pixel by more than one level.

The grain's pattern changes with each image: a view whose grain is drawn is drawn again at every
image, at rest too. The dither's pattern changes with each image that is drawn; a view at rest, which
is not drawn again, keeps the pattern of its last image (the held image is 8 bits, and a new noise
added to it averages, over the images, to the held image and not to the light). To draw every image at
rest, as the reference does, open the session with `drawConverged: true`.

## Outline

`effect.outline({ objects, color, thickness })` lines the visible silhouette of `objects`, each with
its subtree (a runtime mesh or a loaded model's node, at whatever detail is drawn), over the display
image after tone mapping, so `color` (`#ff9f1c` by default) shows as written; `thickness` (`2` by
default, up to `32`) is in CSS pixels. What hides a selected object hides its line.
`outline.objects = [...]`, `outline.color.set(...)` and `outline.thickness` show next frame; with no
object, no pass runs and nothing is allocated.
