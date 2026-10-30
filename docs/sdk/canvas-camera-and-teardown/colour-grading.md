# Colour grading

The display turns the exposed light into the colour it shows through one table, baked from the
scene's display curve and these settings, `world.colorGrading`, also options of `createWorld`,
`explorer.setColorGrading(field, value)`, and the tool `trillion3d_set_color_grading`. A write applies
from the next frame and bakes the table again; `null` gives the default back. With nothing written the
colour is the film curve's own: no white balance, no grade.

- The film curve's own settings, its expansion of a bright colour's gamut, its blue correction and its
  amount shape the curve the scene gets by default (`toneMapping: 'filmic'`).
- The white balance, the grade, the correction, the display's gamma and the table apply to every curve
  but `'none'`.
- The translucent layers and the particles drawn over a display filter show their colours through the
  same chain, so a grade, a white balance or a transfer moves them with the scene under them.
- The scene's `toneMapping: 'filmic'` has two methods, `tonemappingMethod`: the film curve, and the
  standard output transform of the film industry's colour system, in two versions (`acesVersion`). The
  scene's curve is `'filmic'` or `'none'`, and no other.

| Setting | Default | Meaning |
| --- | --- | --- |
| `tonemappingMethod` | `'filmic'` | How the scene's `'filmic'` display curve turns the light into colour: `'filmic'`, the film curve; `'standardAces'`, the standard output transform of the film industry's colour system. The film curve's settings below, the blue correction, the correction's polynomial and the display gamma's ratio do not shape it; the expansion of the gamut, the white balance and the grade do. |
| `acesVersion` | `2` | 1 or 2: the version of the standard output transform. 2 is a model of the colour's lightness, colourfulness and hue, whose tone scale is fitted to a 100-nit display, whose colourfulness is compressed with the lightness and whose colours outside the display's gamut are pulled in along lines of constant hue; 1 is the earlier one, which works on the three channels (a glow on dark saturated colours, a pull of the reds by hue, a desaturation and a tone scale of a display of 1000 nits, of which the 100 an sRGB display shows are kept): **its picture is much brighter** (a neutral light of 0.18 is shown 0.26 in linear display light against version 2's 0.16). Only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it. |
| `acesGamutCompression` | `0` | From 0 to 1: the share of a compression of the colours past the gamut's edge that version 1 applies first; 0 applies none. Version 2 does not read it, and `applyColorGrading: false` does not reset it. |
| `acesSceneColorMultiplier` | `1.5` | From 0: the factor the light is multiplied by before the standard output transform; only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it. |
| `filmSlope`, `filmToe`, `filmShoulder`, `filmBlackClip`, `filmWhiteClip` | `0.88`, `0.55`, `0.26`, `0`, `0.04` | The film curve: the straight run's slope in log luminance (any number but 0, which divides by it), how much of the range the toe (dark end) and the shoulder (bright end) bend over, and how far the black and the white are lifted. A toe above 0.8 puts middle grey on the straight run. |
| `blueCorrection` | `0.6` | 0 to 1: how far saturated blues are pulled toward the centre of the working gamut before the curve and given back after it. |
| `expandGamut` | `1` | From 0: how far a bright, saturated colour is carried toward a wider gamut before the curve; 0 expands none. |
| `toneCurveAmount` | `1` | From 0: how much of the curve is mixed into the colour; 0, with `expandGamut` 0, takes the curve away. |
| `temperatureType` | `'whiteBalance'` | How the next two are read: `'whiteBalance'`, the white the scene was lit by, which is taken to white; `'colorTemperature'`, the colour of the light the image is turned toward. |
| `whiteTemperature`, `whiteTint` | `6500`, `0` | The white balance's temperature in kelvins and tint, −1 green to 1 magenta; 6500 and 0 leave the light as it is. Any number: the chain stays finite for every temperature. |
| `colorSaturation…`, `colorContrast…`, `colorGamma…`, `colorGain…`, `colorOffset…` | `1` (offset `0`) | The grade: five operations, each four numbers (`Red`, `Green`, `Blue` and `Master`, the one the three share) for all the light (`colorGainRed`), for its dark part (`colorGainShadowsRed`), its middle (`colorGainMidtonesRed`) and its bright part (`colorGainHighlightsRed`), which apply over the whole light's: 80 settings. A saturation of 1 leaves the colour, 0 takes it to its luminance; a contrast is the power about middle grey (0.18); a gamma the power 1 over it; a gain multiplies; an offset adds after the gain. |
| `colorCorrectionShadowsMax`, `colorCorrectionHighlightsMin`, `colorCorrectionHighlightsMax` | `0.09`, `0.5`, `1` | Where the dark part ends, and where the bright part starts and is whole; the middle is what is left of both. |
| `colorMin`, `colorMid`, `colorMax` | `0`, `0.5`, `1` | The correction of the colour the film curve gives, each from −10 to 10: the polynomial through 0 → min, 0.5 → mid, 1 → max, in linear light. The defaults are the identity. |
| `applyColorGrading` | `true` | `false` reads the white balance, the grade, the film curve's settings, the method and the bounds of the parts at their defaults, whatever was written; the correction, the display's gamma and transfer, the multiplier, version and gamut compression of the standard output transform and the table keep their values. |
| `displayGamma` | `2.2` | The gamma the display is taken to have; its ratio to 2.2 is a power on the film curve's colour. 2.2 changes nothing. |
| `tonemapperGamma` | `0` | 0 keeps the transfer; a number above 1 shows the colour through that gamma in place of the transfer (2.2 is the pure gamma some displays take); a number under 1 is read as 1: no transfer at all, the linear light as the display value. |
| `sdrInverseEotf` | `'default'` | The transfer to the display value: `'default'`, the method's own (the sRGB curve for the film curve, the power 2.4 for `'standardAces'`), `'srgb'`, or `'bt1886'`, the power 2.4 of a studio display. |
| `lutSize` | `32` | The texels a side of the cube the colour is baked into, from 2, with no other limit than the largest 3D texture the device makes (the cube is baked at that side) and the device's memory budget, which admits the cube (4 bytes a texel, 8 where the device has no storage textures of a 10-bit format: 128 KiB at 32, 1 MiB at 64, 64 MiB at 256, twice that without): where the budget's room holds fewer texels the cube is the largest side it holds, never a refusal, and the frame's metrics say so (`toneTable: { side, bytes, why }`). A larger cube follows the curve more closely (at 32 its mean difference from the exact curve is a fifth of one display level, at 64 a twentieth) and costs more to bake. |
| `lutShaper` | `'log'` | How a light addresses the cube: by its logarithm over 14 stops, or `'pq'`, the perceptual quantizer of a high-range display (100 times the light, in nits). |

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
