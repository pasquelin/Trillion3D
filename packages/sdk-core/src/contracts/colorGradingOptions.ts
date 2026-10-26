import {
  ANY_NUMBER as ANY,
  choiceSetting as choice,
  flagSetting as flag,
  INT32_RANGE,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  nonZeroSetting as nonZero,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * How the display turns the light of a view into the colours it shows: the film's own response
 * curve, the white balance, the colour grading of the dark, middle and bright parts, the
 * correction of the display, and the table (the LUT) the curve and the grading are baked into once
 * and read by every pixel. Run-time settings, as `./settingRules.ts` says: no compiler job names
 * them. The view reads them again at each image (`packages/sdk-browser/src/lighting/toneLut.ts`),
 * and bakes the table again only when one of them, or the scene's display curve, changed.
 *
 * Every setting has the reference's default, so with nothing written the colours are the film
 * curve's own: no white balance, no grade, the table 32 texels a side addressed by a logarithm of
 * the light. The grade and the curve's own settings shape the film curve — the scene's `filmic`
 * display curve (`SceneEnvironment.toneMapping`) —; the grade, the white balance, the table and
 * the display's correction apply to every curve a scene may choose but `none`, which shows the
 * light as it is. The curve's expansion of a bright colour's gamut, its blue correction and its
 * amount belong to the film curve alone.
 *
 * The scene's `filmic` display curve has two methods (`tonemappingMethod`): the film curve and
 * the standard output transform of the film industry's colour system (`'standardAces'`), which the
 * film curve's own settings do not shape.
 */

/** How the temperature and the tint are read: as the white the scene was lit by, which is taken
 *  to white (`whiteBalance`), or as the colour of the light the image is turned toward
 *  (`colorTemperature`). */
const TEMPERATURE_TYPES = ['whiteBalance', 'colorTemperature'] as const
/** The method of the scene's `filmic` display curve: the film curve, or the standard output
 *  transform of the film industry's colour system. */
const TONEMAPPING_METHODS = ['filmic', 'standardAces'] as const
/** The curve that turns display-linear light into the display's value: the method's own — the sRGB
 *  one for the film curve, the power 2.4 for the standard output transform —, the sRGB one, or the
 *  power 2.4 of a studio display. */
const SDR_EOTFS = ['default', 'srgb', 'bt1886'] as const
/** How a light is addressed in the table: by a logarithm of it, or by the perceptual quantizer of
 *  a high-range display. */
const LUT_SHAPERS = ['log', 'pq'] as const

/** What a grade does, in the order the grade applies them. */
const GRADE_OPERATIONS = ['Saturation', 'Contrast', 'Gamma', 'Gain', 'Offset'] as const
/** The parts of the light a grade is set for: all of it, or the dark, the middle and the bright
 *  parts, each applied over the whole one. */
const GRADE_ZONES = ['', 'Shadows', 'Midtones', 'Highlights'] as const
/** The four numbers of a grade: a share for the red, the green and the blue, and one for all
 *  three. */
const GRADE_CHANNELS = ['Red', 'Green', 'Blue', 'Master'] as const
type GradeOperation = (typeof GRADE_OPERATIONS)[number]
export type GradeZone = (typeof GRADE_ZONES)[number]
type GradeChannel = (typeof GRADE_CHANNELS)[number]
/** The field of one number of one grade: `colorSaturationRed`, `colorGainShadowsMaster`, … */
export type GradeField = `color${GradeOperation}${GradeZone}${GradeChannel}`

/** Every number of the grade, as its operation, zone, channel and field: zone by zone, operation by
 *  operation, channel by channel — the order of the grade's vectors in the baking's uniform, the
 *  zone times five plus the operation, four numbers each. */
export const GRADE_FIELDS = /* @__PURE__ */ GRADE_ZONES.flatMap((zone) =>
  GRADE_OPERATIONS.flatMap((operation) =>
    GRADE_CHANNELS.map((channel) => ({
      operation,
      zone,
      channel,
      field: `color${operation}${zone}${channel}` as GradeField,
    })),
  ),
)

/** What a grade operation leaves a colour as it is: an offset adds 0, the rest scale by 1. */
const gradeDefault = (operation: GradeOperation) => (operation === 'Offset' ? 0 : 1)

/** The number rule of the field `F`: the one type of a generated field's rule. */
type NumberRule<F extends string> = ReturnType<typeof number<F>>

/** The grade's twenty vectors of four numbers, one number a field (`GradeField`). */
const GRADE_RULES = /* @__PURE__ */ (() =>
  Object.fromEntries(
    GRADE_FIELDS.map(({ operation, field }) => [
      field,
      number(field, gradeDefault(operation), ANY),
    ]),
  ) as { readonly [F in GradeField]: NumberRule<F> })()

/**
 * The colour settings by field, each with the reference's default.
 *
 * The method of the scene's `filmic` display curve: `tonemappingMethod` (`'filmic'`), the film
 * curve below, or `'standardAces'`, the standard output transform of the film industry's colour
 * system, in which the light is multiplied by `acesSceneColorMultiplier` (1.5) first. The
 * transform has two versions, `acesVersion`: 2 (default), a perceptual model of the colour (hue,
 * colourfulness, lightness) whose tone scale is fitted to a 100-nit display, whose chroma is
 * compressed with the lightness and whose colours outside the display's gamut are pulled in along
 * lines of constant hue; and 1, the earlier one, which works on the colour's three channels — a
 * glow on dark saturated colours, a pull of the reds by hue, a desaturation, the tone scale of a
 * display of 1000 nits, of which the 100 an sRGB display shows are kept — and which
 * `acesGamutCompression` (0, from 0 to 1) can precede by that share of a compression of the
 * colours past the gamut's edge; version 2 does not read it. The white balance, the expansion of
 * the gamut and the grade apply to both; the film curve's settings, the blue correction, the
 * correction's polynomial and the display gamma's ratio belong to the film curve alone.
 *
 * The film curve, applied to the light after its expansion to a wider gamut and before its blue
 * correction is undone:
 * - `filmSlope` (0.88, any number but 0), `filmToe` (0.55), `filmShoulder` (0.26), `filmBlackClip` (0) and
 *   `filmWhiteClip` (0.04): the slope of the straight run in log luminance, how much of the range
 *   the toe and the shoulder bend over, and how far the black and the white are lifted;
 * - `blueCorrection` (0.6), from 0 to 1: how far saturated blues are pulled toward the centre of
 *   the working gamut before the curve and given back after it;
 * - `expandGamut` (1), from 0: how far a bright, saturated colour is carried toward a wider gamut
 *   before the curve; 0 expands none;
 * - `toneCurveAmount` (1), from 0: how much of the curve is mixed into the colour; 0 and
 *   `expandGamut` 0 take the curve away.
 *
 * The white balance, applied to the light first:
 * - `temperatureType` (`'whiteBalance'`): how the next two are read;
 * - `whiteTemperature` (6500) in kelvins and `whiteTint` (0), from −1, green, to 1, magenta: the
 *   white the light is taken for; 6500 and a tint of 0 leave the light as it is.
 *
 * The grade of the colour, by zone, in the working gamut: each of `colorSaturation`,
 * `colorContrast`, `colorGamma`, `colorGain` and `colorOffset` is a vector of four numbers —
 * `Red`, `Green`, `Blue` and `Master`, the share the three together are multiplied by, or an offset
 * adds — set for all the light (`colorSaturationRed`), or for its dark (`colorSaturationShadowsRed`),
 * middle (`…Midtones…`) and bright (`…Highlights…`) parts, which multiply the whole one's. A
 * saturation of 1 leaves the colour, a contrast and a gamma of 1 and a gain of 1 and an offset of
 * 0 too (the defaults), a saturation of 0 takes it to its luminance. The parts are told by the
 * luminance: `colorCorrectionShadowsMax` (0.09) is where the dark part fades out,
 * `colorCorrectionHighlightsMin` (0.5) and `colorCorrectionHighlightsMax` (1) where the bright part
 * starts and where it is whole; the middle is what is left of both.
 *
 * The correction of the colour the curve gives, in the display's linear light, a polynomial that
 * takes 0 to `colorMin` (0), 0.5 to `colorMid` (0.5) and 1 to `colorMax` (1), each read from
 * −10 to 10; the defaults make it the identity. `applyColorGrading` (on) turns the grade, the white
 * balance, the curve's settings and these off, to the defaults, when `false`.
 *
 * The display: `displayGamma` (2.2) the gamma it is taken to have, whose ratio to 2.2 is a power
 * on the film curve's colour (2.2 changes nothing); `tonemapperGamma` (0): 0 keeps the transfer,
 * above 0 the colour is shown through that power's inverse in place of the sRGB curve, a number
 * under 1 read as 1 — no transfer at all, the linear light as the display value; `sdrInverseEotf`
 * (`'default'`): the curve that takes the display-linear colour to its value — `'srgb'`, the sRGB
 * curve, or `'bt1886'`, the power 2.4 —, the method's own where `'default'`: sRGB for the film
 * curve, the power 2.4 for the standard output transform.
 *
 * The table: `lutSize` (32), the texels a side of the cube the colour is baked into and read
 * from, from 2 and with no other limit than the largest 3D texture the device makes — the cube is
 * baked at that side — and the memory the view may hold, which counts the cube (4 bytes a texel,
 * 8 where the device has no storage textures of a 10-bit format: 128 KiB at 32, 64 MiB at 256, twice that); `lutShaper` (`'log'`): how a light addresses the cube, by its
 * logarithm or by the perceptual quantizer (`'pq'`, which the `cinematic` quality level writes,
 * with a table of 64 texels a side: `COLOR_GRADING_PRESET_LEVELS`).
 */
export const COLOR_GRADING_RULES = /* @__PURE__ */ (() => ({
  ...rulesOf([
    choice('tonemappingMethod', 'filmic', TONEMAPPING_METHODS),
    nonNegative('acesSceneColorMultiplier', 1.5),
    integer('acesVersion', 2, [1, 2]),
    number('acesGamutCompression', 0, [0, 1]),
    nonZero('filmSlope', 0.88, 'a number but 0'),
    number('filmToe', 0.55, ANY),
    number('filmShoulder', 0.26, ANY),
    number('filmBlackClip', 0, ANY),
    number('filmWhiteClip', 0.04, ANY),
    number('blueCorrection', 0.6, [0, 1]),
    nonNegative('expandGamut', 1),
    nonNegative('toneCurveAmount', 1),
    choice('temperatureType', 'whiteBalance', TEMPERATURE_TYPES),
    number('whiteTemperature', 6500, ANY),
    number('whiteTint', 0, ANY),
    number('colorCorrectionShadowsMax', 0.09, ANY),
    number('colorCorrectionHighlightsMin', 0.5, ANY),
    number('colorCorrectionHighlightsMax', 1, ANY),
    number('colorMin', 0, [-10, 10]),
    number('colorMid', 0.5, [-10, 10]),
    number('colorMax', 1, [-10, 10]),
    flag('applyColorGrading', true),
    positive('displayGamma', 2.2, 'a number above 0'),
    nonNegative('tonemapperGamma', 0),
    choice('sdrInverseEotf', 'default', SDR_EOTFS),
    integer('lutSize', 32, [2, INT32_RANGE[1]]),
    choice('lutShaper', 'log', LUT_SHAPERS),
  ] as const),
  ...GRADE_RULES,
}))()
/** What the quality levels write of the colour settings: only `cinematic` does, a table of 64 texels a
 *  side addressed by the perceptual quantizer; every other level leaves the table of 32 texels
 *  addressed by a logarithm, the defaults (`runtime/qualityLevels.ts`). */
export const COLOR_GRADING_PRESET_LEVELS = { cinematic: { lutSize: 64, lutShaper: 'pq' } } as const
/** The field of one colour setting. */
export type ColorGradingField = keyof typeof COLOR_GRADING_RULES
/** The colour settings as a host writes them, by their fields: each its value, or nothing for its
 *  default. */
export type ColorGradingSettings = SettingOptions<typeof COLOR_GRADING_RULES>
/** The colour settings as the engine reads them: every field set. */
export type ColorGradingValues = SettingValues<typeof COLOR_GRADING_RULES>
