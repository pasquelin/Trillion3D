import {
  GRADE_FIELDS,
  type ColorGradingField,
  type GradeField,
  type GradeZone,
} from '../contracts/colorGradingOptions.ts'

/** The part of the light a grade is set for, in a property's few words: what each operation does is
 *  said once, in the tool's text (`runtimeToolsSchema.ts`). */
const ZONE_WORDS: Readonly<Record<GradeZone, string>> = {
  '': 'all the light',
  Shadows: 'dark part',
  Midtones: 'middle part',
  Highlights: 'bright part',
}

/** The grade's eighty numbers, each in under 60 characters: "gain, dark part, red". */
const GRADE_MEANINGS = /* @__PURE__ */ (() =>
  Object.fromEntries(
    GRADE_FIELDS.map(({ operation, zone, channel, field }) => [
      field,
      `${operation.toLowerCase()}, ${ZONE_WORDS[zone]}, ${channel.toLowerCase()}`,
    ]),
  ) as Readonly<Record<GradeField, string>>)()

/** What each colour setting of the display means (`../contracts/colorGradingOptions.ts`): the film
 *  curve, the white balance, the grade, the correction, the display's gamma and the table. */
export const COLOR_GRADING_MEANINGS: Readonly<Record<ColorGradingField, string>> =
  /* @__PURE__ */ (() => ({
    ...GRADE_MEANINGS,
    tonemappingMethod:
      "How the scene's 'filmic' display curve turns light into colour: 'filmic' (default), the film curve; or 'standardAces', the standard output transform of the film industry's colour system, which the film curve's settings, the correction's polynomial and the display gamma's ratio do not shape.",
    acesSceneColorMultiplier:
      "The factor the light is multiplied by before the standard output transform, from 0 (default 1.5); only the method 'standardAces' reads it.",
    acesVersion:
      "The version of the standard output transform, 1 or 2 (default 2): 2 works on the colour's hue, colourfulness and lightness; 1, the earlier one, on its three channels, with the tone scale of a 1000-nit display cut at the 100 an sRGB display shows. Only the method 'standardAces' reads it.",
    acesGamutCompression:
      "How much of a compression of the colours past the gamut's edge version 1 of the standard output transform applies first, from 0 to 1 (default 0, none); version 2 does not read it.",
    filmSlope:
      "The film curve's slope in log luminance, the steepness of its straight run, any number but 0 (default 0.88).",
    filmToe:
      "How much of the range the film curve's toe bends over, the dark end (default 0.55); above 0.8 middle grey lies on the straight run.",
    filmShoulder:
      "How much of the range the film curve's shoulder bends over, the bright end (default 0.26).",
    filmBlackClip: 'How far the film curve lifts its black (default 0).',
    filmWhiteClip: 'How far the film curve lifts its white above 1 (default 0.04).',
    blueCorrection:
      'How far saturated blues are pulled toward the centre of the working gamut before the film curve and given back after it, from 0 to 1 (default 0.6).',
    expandGamut:
      'How far a bright saturated colour is carried toward a wider gamut before the film curve, from 0: 0 expands none (default 1).',
    toneCurveAmount:
      'How much of the film curve is mixed into the colour, from 0 (default 1); 0, with expandGamut 0, takes the curve away.',
    temperatureType:
      "How whiteTemperature and whiteTint are read: 'whiteBalance' (default), the white the scene was lit by, which is taken to white; or 'colorTemperature', the colour of the light the image is turned toward.",
    whiteTemperature:
      "The white balance's temperature in kelvins (default 6500, which with a tint of 0 leaves the light as it is).",
    whiteTint: "The white balance's tint, from -1, green, to 1, magenta (default 0).",
    colorCorrectionShadowsMax:
      'The luminance up to which the light is dark for the grade (default 0.09): the dark part fades out to nothing there.',
    colorCorrectionHighlightsMin:
      'The luminance from which the light starts to be bright for the grade (default 0.5).',
    colorCorrectionHighlightsMax:
      'The luminance from which the light is wholly bright for the grade (default 1); it should be over colorCorrectionHighlightsMin.',
    colorMin:
      "Where 0 is taken to after the film curve, in the display's linear light, from -10 to 10 (default 0): above 0 a grey is added to the darks, below it more dark values become black.",
    colorMid:
      'Where 0.5 is taken to after the film curve, from -10 to 10 (default 0.5): like a gamma, lower darkens the middle tones, higher brightens them.',
    colorMax:
      'Where 1 is taken to after the film curve, from -10 to 10 (default 1): lower darkens the highlights, higher carries more colours to white.',
    applyColorGrading:
      "Whether the white balance, the grade, the film curve's settings and the correction apply (default true); false shows them at their defaults.",
    displayGamma:
      "The gamma the display is taken to have (default 2.2): its ratio to 2.2 is a power on the film curve's colour; 2.2 changes nothing. Above 0.",
    tonemapperGamma:
      'A gamma the colour is shown through in place of the sRGB curve (default 0, which keeps the transfer); a number under 1 is read as 1, no transfer at all.',
    sdrInverseEotf:
      "The curve that takes the display-linear colour to its value: 'default' (default), the method's own — sRGB for the film curve, the power 2.4 for 'standardAces' —, 'srgb', or 'bt1886', the power 2.4 of a studio display.",
    lutSize:
      "The texels a side of the cube the colour is baked into once and every pixel reads (default 32), a whole number from 2: a larger cube follows the curve more closely, costs more to bake and holds 4 bytes a texel of the view's memory (8 where the device has no storage textures of a 10-bit format), up to the largest 3D texture the device makes. The quality level 'cinematic' writes 64.",
    lutShaper:
      "How a light addresses the cube: 'log' (default), by its logarithm, or 'pq', by the perceptual quantizer of a high-range display. The quality level 'cinematic' writes 'pq'.",
  }))()
