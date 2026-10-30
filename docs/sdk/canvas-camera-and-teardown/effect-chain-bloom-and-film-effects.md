# Effect chain, bloom and film effects

`world.effects`: ordered pass chain after temporal antialiasing, before the canvas.
`world.effects.add(pass, index?)`, `remove(pass)`, `clear()` change it; settings show next frame.

## Bloom, vignette and local exposure

A world starts with `effect.bloom()`: six Gaussian blurs added before exposure and curve; default
`intensity` `0.675`. `intensity` 0 or `world.effects.clear()` removes it.

`effect.bloom({ intensity, threshold, sizeScale, levels })`: `threshold` (`-1`: every pixel glows)
= exposed luminance past which a pixel glows.

- `sizeScale` (`4`): multiplier of every level's width.
- `levels`: six `{ size, tint }`, finest first. `size` = percent of level width (`0.3`, `1`, `2`,
  `10`, `30`, `64`; 0 omits the level); `tint` = number or `[r, g, b]` (`0.3465`, `0.138`, `0.1176`,
  `0.066`, `0.066`, `0.061`).

`world.vignette` (`0.4`; 0 none) darkens corners. Local exposure, in `world.exposureSettings`:
`localExposureHighlightContrast` and `localExposureShadowContrast` (`0.8`),
`localExposureDetailStrength` (`1`), `localExposureBlurBlend` (`0.6`), `localExposureBlurSize`
(`50`), `localExposureMiddleGreyBias` (`0`), the two thresholds (`0`) and their strengths (`1`). On
by default; both contrasts `1` with detail `1` turns it off.

```js
const [bloom] = world.effects.passes // the bloom the world started with
bloom.intensity = 0.3 // a fainter glow; 0 turns it off, `world.effects.clear()` removes it
world.vignette = 0.2 // a lighter vignette; 0 none
world.exposureSettings = { localExposureHighlightContrast: 1, localExposureShadowContrast: 1 } // local exposure off
```

## Film effects

Applied to the lit image after exposure, before the curve. Run-time settings `world.film`, also
`createWorld` options and `explorer.setFilm(field, value)`; agents use `trillion3d_set_film`.
Defaults: vignette and dither on; grain, fringe, tint off. A write applies next frame; `null`
restores the default or quality level's. Albedo views, diagnostic views, captures show none.

| Setting | Default | Meaning |
| - | - | - |
| `filmGrainIntensity` | `0` | Grain strength. |
| `filmGrainIntensityShadows`, `filmGrainIntensityMidtones`, `filmGrainIntensityHighlights` | `1` | Grain share per band. |
| `filmGrainShadowsMax` | `0.09` | Luminance up to which a pixel is dark. |
| `filmGrainHighlightsMin`, `filmGrainHighlightsMax` | `0.5`, `1` | Luminance where bright starts / is wholly so. |
| `filmGrainScaleX`, `filmGrainScaleY` | `1` | Grain size per axis. |
| `filmGrainSequenceLength` | `97` | Images before the pattern repeats. |
| `chromaticAberration` | `0` | Fringe, percent of distance to centre; 0.01 or less none. |
| `chromaticAberrationStartOffset` | `0` | Centre distance (0 to 1) where it starts. |
| `chromaticAberrationQuality` | `'high'` | `'off'`: no fringe. |
| `chromaticAberrationMax` | `-1` | −1 leaves intensity; 0 or more caps it; −2 forces 5. |
| `vignetteType` | `'cosineFourthLaw'` | Or `'oval'`. |
| `vignetteColorRed`, `vignetteColorGreen`, `vignetteColorBlue` | `0` | Colour darkened toward. |
| `vignetteCenterX`, `vignetteCenterY` | `0.5` | Brightest point. |
| `vignetteSizeX`, `vignetteSizeY`, `vignetteSoftness` | `1`, `1`, `5` | Oval extent, fall-off. |
| `tonemapperQuality` | `5` | 0 to 5: under 2 vignette off, under 4 grain off. Levels write 0 `'smooth'`, 2 `'balanced'`, 5 `'fine'`/`'cinematic'`. |
| `tonemapperSharpen` | `-1` | Below 0: scene `sharpness`; 0 or more replaces it (0 to 10). |
| `sceneColorTintRed`, `sceneColorTintGreen`, `sceneColorTintBlue` | `1` | Scene colour multiplier. |
| `quantizationDitheringBits` | `0` | Triangular dither, one display level. 0 or less: target's step (1/255 for 8-bit); bits: 1/(2^bits − 1). |
| `propagateAlpha` | `false` | On: alpha = share of background left visible (1 nothing drawn, 0 surface) times transmittance of sky, fog, clouds, translucent layers; captures hold it. Off: opaque. |
| `primitiveAlphaHoldout` | `false` | With `propagateAlpha`: a layer of blending `'alphaHoldout'`, or sky, clouds, height fog with `holdout`, punches a hole in alpha. |
| `translucencyHoldoutLocation` | `'beforeDepthOfField'` | Where accumulated alpha is laid: `'beforeDepthOfField'` or `'afterDepthOfField'`. |

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

Scene `sharpness` (scene `environment`): 0 (default) to 10. A view with grain redraws every image;
a resting view keeps its last dither pattern unless the session opens with `drawConverged: true`.

## Outline

`effect.outline({ objects, color, thickness })` lines the visible silhouette of `objects` (with
subtrees) after tone mapping; `color` (`#ff9f1c`); `thickness` (`2`, up to `32`) CSS pixels.
`outline.objects = [...]`, `outline.color.set(...)`, `outline.thickness` show next frame; no
object: no pass runs.
