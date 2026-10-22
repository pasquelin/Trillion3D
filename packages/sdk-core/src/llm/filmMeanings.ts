import type { FilmField } from '../contracts/filmOptions.ts'

/** What each film setting of the display finishing means (`../contracts/filmOptions.ts`): the
 *  grain, the colour fringe, the vignette's look, the tonemapper and the dither. */
export const FILM_MEANINGS: Readonly<Record<FilmField, string>> = {
  filmGrainIntensity:
    "The film grain's overall strength, 0 by default: none. The grain multiplies the exposed light by a noise of mean 1, so the image keeps its average brightness. It is read as 0 when tonemapperQuality is under 4.",
  filmGrainIntensityShadows:
    "The share of the film grain in the dark pixels (default 1); it is the grain's strength where the pixel's luminance is under filmGrainShadowsMax.",
  filmGrainIntensityMidtones:
    'The share of the film grain in the pixels between the dark and the bright ones (default 1).',
  filmGrainIntensityHighlights:
    "The share of the film grain in the bright pixels (default 1); it is the grain's strength where the pixel's luminance is over filmGrainHighlightsMax. All three shares at 0 draw no grain.",
  filmGrainShadowsMax:
    'The luminance up to which a pixel is dark for the film grain (default 0.09): the dark share fades out to nothing there.',
  filmGrainHighlightsMin:
    'The luminance from which a pixel starts to be bright for the film grain (default 0.5).',
  filmGrainHighlightsMax:
    'The luminance from which a pixel is wholly bright for the film grain (default 1); it should be over filmGrainHighlightsMin.',
  filmGrainScaleX:
    'The width of a film grain, as a multiple of a texel (default 1): a texel is one pixel on an image 1920 wide, and the grain grows with the image.',
  filmGrainScaleY: 'The height of a film grain, as filmGrainScaleX is its width (default 1).',
  filmGrainSequenceLength:
    "The number of images after which the film grain's pattern repeats (default 97, preferably a prime number); a whole number from 1.",
  chromaticAberration:
    "The colour fringe's intensity, in percent of the distance to the centre, 0 by default: none. The red and the green of a pixel are read nearer the centre of the image than its blue, by their wavelengths, which fringes edges toward the corners. An intensity of 0.01 or less draws nothing.",
  chromaticAberrationStartOffset:
    'How far from the centre along each axis the colour fringe starts, from 0, the centre, to 1, the edge of the image (default 0); 1 draws nothing.',
  chromaticAberrationQuality:
    "The colour fringe's quality: 'off' draws no fringe whatever its intensity, 'high' (default) reads three samples a pixel. The quality levels write 'off' at 'smooth' and 'balanced'.",
  chromaticAberrationMax:
    'Caps the colour fringe: -1 (default) leaves its intensity as it is, 0 or more caps it there, -2 forces an extreme one, 5, to look at the fringe.',
  vignetteType:
    "The shape of the vignette's falloff: 'cosineFourthLaw' (default), the law of a lens, or 'oval', whose edge is vignetteSizeX and vignetteSizeY and whose fall is vignetteSoftness. The strength is the scene's (environment.vignette, 0.4).",
  vignetteColorRed: 'The red of the colour the vignette darkens toward (default 0, black).',
  vignetteColorGreen: 'The green of the colour the vignette darkens toward (default 0, black).',
  vignetteColorBlue: 'The blue of the colour the vignette darkens toward (default 0, black).',
  vignetteCenterX:
    'Where the vignette is brightest along the width (default 0.5, the middle); the cosine-fourth law moves its centre by this distance from 0.5.',
  vignetteCenterY: 'Where the vignette is brightest along the height (default 0.5, the middle).',
  vignetteSizeX:
    "The oval vignette's width (default 1); a smaller one narrows it. Read from 0.001.",
  vignetteSizeY: "The oval vignette's height (default 1). Read from 0.001.",
  vignetteSoftness:
    "How fast the oval vignette falls to its colour (default 5): the oval's light is its distance's complement to this power.",
  tonemapperQuality:
    "The tonemapper's quality, from 0 to 5 (default 5): under 2 the vignette is off, under 4 the film grain is. The quality levels write 0 at 'smooth' and 2 at 'balanced'.",
  tonemapperSharpen:
    "The tonemapper's sharpening: below 0 (default -1) the scene's own sharpness (environment.sharpness), 0 or more replaces it, read from 0 to 10; 1 is a unit-gain sharpening.",
  sceneColorTintRed:
    "The red of the tint the scene's colour is multiplied by (default 1); the bloom's glow is not tinted.",
  sceneColorTintGreen: "The green of the scene's tint (default 1).",
  sceneColorTintBlue: "The blue of the scene's tint (default 1).",
  quantizationDitheringBits:
    "The dither that hides the display's steps: a triangular noise of one level of the display's channel added to the colour shown. 0 (default) takes the step from the display, 1/255 for an 8-bit one; a number of bits from 1 makes the step 1/(2^bits - 1). From 24 bits no dither is drawn: set 32 to switch it off, for images compared pixel for pixel.",
}
