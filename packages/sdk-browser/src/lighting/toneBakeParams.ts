import {
  COLOR_GRADING_RULES,
  GRADE_FIELDS,
  type ColorGradingField,
  type ColorGradingValues,
} from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { putVec4 } from '../gpu/core/fieldLayout.ts'
import { filmCurveOf } from './filmCurveConstants.ts'
import { writeFilmCurve } from './filmCurveWgsl.ts'
import { BAKE_LAYOUT, tableScale } from './toneBakeWgsl.ts'
import { balances, whiteBalanceMatrix } from './whiteBalance.ts'

const AT = BAKE_LAYOUT.at

/** The settings that stay what the host wrote when `applyColorGrading` is off: the correction's
 *  polynomial, the display's gamma and transfer, the multiplier of the standard output
 *  transform's light, its version and gamut compression, and the table — the reference's own variables, which the switch leaves
 *  alone —; every other one, the method among them, is read at its default. */
const ALWAYS: ReadonlySet<ColorGradingField> = new Set([
  'applyColorGrading',
  'colorMin',
  'colorMid',
  'colorMax',
  'displayGamma',
  'tonemapperGamma',
  'sdrInverseEotf',
  'acesSceneColorMultiplier',
  'acesVersion',
  'acesGamutCompression',
  'lutSize',
  'lutShaper',
])
/** The defaults of the settings the switch turns off, by field. */
const SWITCHED = Object.fromEntries(
  Object.entries(resolveSettings(COLOR_GRADING_RULES, {})).filter(
    ([field]) => !ALWAYS.has(field as ColorGradingField),
  ),
) as Partial<ColorGradingValues>
/** The settings as the baking reads them where the switch is off: written over, not made again. */
const defaulted = {} as ColorGradingValues

/** The settings the baking reads for `values`: themselves, or, where `applyColorGrading` is off,
 *  the ones the switch turns off at their defaults. The object is the same at each call that needs
 *  it made: read it before the next. */
const bakedValues = (values: ColorGradingValues) =>
  values.applyColorGrading ? values : Object.assign(defaulted, values, SWITCHED)

/** Whether the film curve's place is the standard output transform's, for the settings `v` under
 *  the display curve of rank `rank`: only a scene whose curve is the film curve has a method. */
const runsStandardAces = (v: ColorGradingValues, rank: number) =>
  rank === TONE_MAPPING_RANK.filmic && v.tonemappingMethod === 'standardAces'

/** Whether the display's transfer is the power 2.4: asked for, or the method's own
 *  (`standardAces`) where the setting leaves it to the method. */
const showsPower24 = (v: ColorGradingValues, standardAces: boolean) =>
  v.sdrInverseEotf === 'bt1886' || (v.sdrInverseEotf === 'default' && standardAces)

/** The correction's polynomial `a x² + b x + c`, which takes 0 to `min`, 0.5 to `mid` and 1 to
 *  `max`: the three, each held to ±10, as `a`, `b` and `c`. */
function polynomial({ colorMin, colorMid, colorMax }: ColorGradingValues) {
  const c = colorMin,
    b = 4 * colorMid - 3 * colorMin - colorMax
  return [colorMax - colorMin - b, b, c] as const
}

/** The grade's twenty vectors, zone by zone and operation by operation (`GRADE_VECTORS`): the
 *  eighty numbers of `GRADE_FIELDS`, in its order. */
function writeGrade(words: Float32Array, values: ColorGradingValues) {
  GRADE_FIELDS.forEach(({ field }, i) => {
    words[AT.grade + i] = values[field]
  })
}

/**
 * Writes the baking's uniform (`BAKE_LAYOUT`) into `words` for the settings `values` and the rank
 * `rank` of the scene's display curve: the same words for the same settings, so a view compares
 * them to the last baked and bakes again only when they differ. With `applyColorGrading` off the
 * white balance, the grade, the film curve's settings and the bounds of the parts are their
 * defaults. The white balance is a matrix made here, once, from the temperature, the tint and the
 * way they are read; none is written where they are the neutral pair, which the shader tests once.
 * The bounds of the dark and of the bright part are written as they are, in any order
 * (`HERMITE_WGSL`).
 */
export function writeBake(words: Float32Array, values: ColorGradingValues, rank: number) {
  const v = bakedValues(values)
  words.fill(0)
  const balanced = balances(v.whiteTemperature, v.whiteTint)
  if (balanced) {
    const matrix = whiteBalanceMatrix(
      v.whiteTemperature,
      v.whiteTint,
      v.temperatureType === 'colorTemperature',
    )
    for (let column = 0; column < 3; column++) {
      const [x, y, z] = matrix.slice(3 * column, 3 * column + 3)
      putVec4(words, AT.wb + 4 * column, x, y, z)
    }
  }
  writeFilmCurve(words, AT.film, filmCurveOf(v))
  writeGrade(words, v)
  putVec4(
    words,
    AT.bounds,
    v.colorCorrectionShadowsMax,
    v.colorCorrectionHighlightsMin,
    v.colorCorrectionHighlightsMax,
    balanced ? 1 : 0,
  )
  const [a, b, c] = polynomial(v)
  putVec4(words, AT.mapping, a, b, c, 2.2 / v.displayGamma)
  const aces = runsStandardAces(v, rank)
  putVec4(
    words,
    AT.device,
    1 / Math.max(v.tonemapperGamma, 1),
    showsPower24(v, aces) ? 1 : 0,
    v.tonemapperGamma > 0 ? 1 : 0,
    tableScale(rank, v.tonemapperGamma > 0, aces),
  )
  putVec4(words, AT.lattice, 1 / (v.lutSize - 1), v.lutSize, rank, v.lutShaper === 'pq' ? 1 : 0)
  const first = v.acesVersion === 1
  putVec4(
    words,
    AT.aces,
    aces ? 1 : 0,
    v.acesSceneColorMultiplier,
    first ? 1 : 0,
    first ? v.acesGamutCompression : 0,
  )
}
