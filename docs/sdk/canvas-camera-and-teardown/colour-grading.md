# Colour grading

`world.colorGrading` (also `createWorld` options, `explorer.setColorGrading(field, value)`, tool
`trillion3d_set_color_grading`) bakes one table from the display curve and these settings. A write
applies next frame and rebakes; `null` restores the default. Nothing written: film curve, no white
balance, no grade.

- Film curve settings, gamut expansion, blue correction and amount shape the default curve
  (`toneMapping: 'filmic'`).
- White balance, grade, correction, display gamma and table apply to every curve but `'none'`.
- Scene `toneMapping: 'filmic'` has two methods, `tonemappingMethod`: film curve, or the standard
  output transform (`acesVersion` 1 or 2).

| Setting | Default | Meaning |
| - | - | - |
| `tonemappingMethod` | `'filmic'` | `'filmic'` film curve; `'standardAces'` standard output transform, unshaped by film curve settings, blue correction, correction polynomial and display gamma ratio (gamut expansion, white balance, grade apply). |
| `acesVersion` | `2` | 1 or 2. 1 is per channel, **much brighter** (neutral 0.18 shows 0.26 in linear display light vs 0.16). Only `'standardAces'` reads it; `applyColorGrading: false` keeps it. |
| `acesGamutCompression` | `0` | 0 to 1: past-gamut compression, version 1 only; `applyColorGrading: false` keeps it. |
| `acesSceneColorMultiplier` | `1.5` | From 0: light multiplier before the transform; `'standardAces'` only; `applyColorGrading: false` keeps it. |
| `filmSlope`, `filmToe`, `filmShoulder`, `filmBlackClip`, `filmWhiteClip` | `0.88`, `0.55`, `0.26`, `0`, `0.04` | Film curve: slope (any number but 0), toe and shoulder ranges, black and white lift. Toe above 0.8 puts middle grey on the straight run. |
| `blueCorrection` | `0.6` | 0 to 1: saturated blues pulled toward the gamut's centre before the curve. |
| `expandGamut` | `1` | From 0: bright saturated colour carried toward a wider gamut before the curve; 0 none. |
| `toneCurveAmount` | `1` | From 0: curve share mixed in; 0 with `expandGamut` 0 removes the curve. |
| `temperatureType` | `'whiteBalance'` | Reading of the next two: `'whiteBalance'` the scene's light, taken to white; `'colorTemperature'` the colour the image turns toward. |
| `whiteTemperature`, `whiteTint` | `6500`, `0` | Kelvins and tint (−1 green to 1 magenta); defaults change nothing. Any number. |
| `colorSaturation…`, `colorContrast…`, `colorGamma…`, `colorGain…`, `colorOffset…` | `1` (offset `0`) | Grade, 80 settings: five operations, each `Red`, `Green`, `Blue`, `Master`, for all light (`colorGainRed`), dark part (`colorGainShadowsRed`), middle (`colorGainMidtonesRed`), bright part (`colorGainHighlightsRed`). Saturation 0 gives luminance; contrast = power about 0.18; gamma = power 1 over it; gain multiplies; offset adds after gain. |
| `colorCorrectionShadowsMax`, `colorCorrectionHighlightsMin`, `colorCorrectionHighlightsMax` | `0.09`, `0.5`, `1` | Dark part ends; bright part starts and is whole; middle = remainder. |
| `colorMin`, `colorMid`, `colorMax` | `0`, `0.5`, `1` | Film-curve colour correction, each −10 to 10: polynomial through 0 → min, 0.5 → mid, 1 → max, linear light. |
| `applyColorGrading` | `true` | `false` reads white balance, grade, film curve settings, method and part bounds at defaults; the rest keeps values. |
| `displayGamma` | `2.2` | Display's assumed gamma; ratio to 2.2 is a power on film-curve colour. |
| `tonemapperGamma` | `0` | 0 keeps transfer; above 1 shows colour through that gamma; under 1 read as 1 (linear). |
| `sdrInverseEotf` | `'default'` | Transfer: `'default'` (sRGB curve for film curve, power 2.4 for `'standardAces'`), `'srgb'`, `'bt1886'` (power 2.4). |
| `lutSize` | `32` | Cube texels a side, from 2; limited by the device's largest 3D texture and memory (4 bytes a texel, 8 without 10-bit storage textures: 128 KiB at 32, 1 MiB at 64, 64 MiB at 256, twice that without). Over budget: largest side that fits, no refusal; metrics report `toneTable: { side, bytes, why }`. |
| `lutShaper` | `'log'` | Cube addressing: log of light over 14 stops, or `'pq'` (perceptual quantizer, 100 times the light, in nits). |

```js
world.colorGrading = { whiteTemperature: 4800, whiteTint: 0.1 } // warm the cold light of a scene
world.colorGrading = { colorSaturationMaster: 1.2, colorContrastMaster: 1.1 } // a richer image
world.colorGrading = { colorGainShadowsBlue: 1.15, colorGainHighlightsRed: 1.05 } // blue shadows, warm highlights
world.colorGrading = { filmSlope: 0.91, filmToe: 0.53, filmShoulder: 0.23, filmWhiteClip: 0.035 } // another film
world.colorGrading = { applyColorGrading: false } // the defaults of the whole grade, keeping the table
world.colorGrading = { tonemappingMethod: 'standardAces' } // the standard output transform, shown through the power 2.4
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  sdrInverseEotf: 'srgb',
  acesSceneColorMultiplier: 1.2,
}
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  acesVersion: 1,
  acesGamutCompression: 0.5,
} // the earlier version, half compressed
world.colorGrading = { colorSaturationMaster: 0 } // a monochrome scene: its tinted glass and its sparks are monochrome too
const world = await createWorld(canvas, { lutSize: 64, colorMin: 0.01 }) // as options
```
