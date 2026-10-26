/**
 * The film curve's constants (`filmCurveWgsl.ts`): a film's own response to light, evaluated in a
 * wide working gamut — the primaries of the ACES grading space — and brought back to sRGB. The
 * published colour spaces are declared (their primaries' matrices to XYZ, the D65 to D60
 * adaptation, the wide gamut a saturated bright colour is pushed toward); the matrices the chain
 * multiplies by are derived from them, once, here. The curve's own numbers are settings
 * (`filmCurveOf`, `FilmCurveSettings`), with the defaults the layers and the inverse read (`FILM`).
 */
import { wgslMatrix3, wgslVec3 } from '../../../math/src/wgsl/number.ts'
import { inverse3, multiply3 } from '../../../math/src/matrix/matrix3.ts'
import {
  COLOR_GRADING_RULES,
  type ColorGradingValues,
} from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { EXPOSURE_MIDDLE_GREY } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'

/** A matrix written row after row, as colour-science tables print it, column after column, as
 *  `wgslMatrix3` and `multiply3` read it. */
export const fromRows = (m: readonly number[]) => [
  m[0],
  m[3],
  m[6],
  m[1],
  m[4],
  m[7],
  m[2],
  m[5],
  m[8],
]

// DECLARED: the primaries, to XYZ (the grading space's two gamuts, sRGB's), the Bradford adaptation
// of sRGB's D65 white to the grading space's D60, and the wide gamut of the expansion.
const AP0_TO_XYZ = fromRows([
  0.9525523959, 0.0, 0.0000936786, 0.3439664498, 0.7281660966, -0.0721325464, 0.0, 0.0,
  1.0088251844,
])
const AP1_TO_XYZ = fromRows([
  0.6624541811, 0.1340042065, 0.156187687, 0.2722287168, 0.6740817658, 0.0536895174, -0.0055746495,
  0.0040607335, 1.0103391003,
])
const SRGB_TO_XYZ = fromRows([
  0.4123907993, 0.3575843394, 0.1804807884, 0.2126390059, 0.7151686788, 0.0721923154, 0.0193308187,
  0.1191947798, 0.9505321522,
])
const D65_TO_D60 = fromRows([
  1.0130349146, 0.0061052578, -0.0149709436, 0.0076982301, 0.9981633521, -0.0050320385,
  -0.0028413174, 0.0046851567, 0.9245061375,
])
const WIDE_TO_XYZ = fromRows([
  0.5441691, 0.2395926, 0.1666943, 0.2394656, 0.702153, 0.0583814, -0.0023439, 0.0361834, 1.0552183,
])
// The blue correction: pulls saturated blues toward the grading space's centre before the curve and
// gives them back after it; the two are one look, the second not the exact inverse of the first.
const BLUE_CORRECT = fromRows([
  0.9404372683, -0.0183068787, 0.0778696104, 0.0083786969, 0.8286599939, 0.1629613092, 0.0005471261,
  -0.0008833746, 1.0003362486,
])
const BLUE_CORRECT_BACK = fromRows([
  1.06318, 0.0233956, -0.0865726, -0.0106337, 1.20632, -0.19569, -0.000590887, 0.00105248, 0.999538,
])

// DERIVED: the grading space's gamuts and sRGB through XYZ.
const XYZ_TO_AP0 = inverse3(AP0_TO_XYZ)
const XYZ_TO_AP1 = inverse3(AP1_TO_XYZ)
const XYZ_TO_SRGB = inverse3(SRGB_TO_XYZ)
const D60_TO_D65 = inverse3(D65_TO_D60)
const AP0_TO_AP1 = multiply3(XYZ_TO_AP1, AP0_TO_XYZ)
const AP1_TO_AP0 = multiply3(XYZ_TO_AP0, AP1_TO_XYZ)
const SRGB_TO_AP1 = multiply3(XYZ_TO_AP1, multiply3(D65_TO_D60, SRGB_TO_XYZ))
const AP1_TO_SRGB = multiply3(XYZ_TO_SRGB, multiply3(D60_TO_D65, AP1_TO_XYZ))
/** The blue correction, and its way back, as the grading gamut's own matrices. */
const BLUE_AP1 = multiply3(AP0_TO_AP1, multiply3(BLUE_CORRECT, AP1_TO_AP0))
const BLUE_BACK_AP1 = multiply3(AP0_TO_AP1, multiply3(BLUE_CORRECT_BACK, AP1_TO_AP0))
/** The expansion: the colour read as sRGB primaries, then as the wide gamut's. */
const EXPAND_AP1 = multiply3(multiply3(XYZ_TO_AP1, WIDE_TO_XYZ), AP1_TO_SRGB)
/** The grading gamut's luminance row. */
const LUMA_AP1 = [AP1_TO_XYZ[1], AP1_TO_XYZ[4], AP1_TO_XYZ[7]]

/** The film curve's own settings, as the contract names them (`colorGradingOptions.ts`): the
 *  look of the curve. Slope, toe and shoulder shape the response: the straight run's slope in log
 *  luminance, how much of the range the toe and the shoulder bend over; the clips lift the black
 *  and the white; the blend and the desaturations before and after, `toneCurveAmount` how much of
 *  the curve is mixed in, `expandGamut` how far a bright saturated colour goes toward the wide
 *  gamut. */
type FilmCurveSettings = Pick<
  ColorGradingValues,
  | 'filmSlope'
  | 'filmToe'
  | 'filmShoulder'
  | 'filmBlackClip'
  | 'filmWhiteClip'
  | 'blueCorrection'
  | 'expandGamut'
  | 'toneCurveAmount'
>

/**
 * The film curve of the settings `s`: where the toe and the shoulder meet the straight run, in
 * log10 luminance, are derived. The toe is placed so that middle grey in comes out middle grey —
 * unless the toe is past 0.8, which puts middle grey on the straight run —; the toe, ending where
 * the run begins, and the shoulder, where it ends, follow from the slope.
 */
export function filmCurveOf(s: FilmCurveSettings) {
  const { filmSlope: slope, filmToe: toe, filmBlackClip: black, filmWhiteClip: white } = s
  const toeScale = 1 + black - toe
  const shoulderScale = 1 + white - s.filmShoulder
  const toeBalance = (EXPOSURE_MIDDLE_GREY + black) / toeScale - 1
  const toeMatch =
    toe > 0.8
      ? (1 - toe - EXPOSURE_MIDDLE_GREY) / slope + Math.log10(EXPOSURE_MIDDLE_GREY)
      : Math.log10(EXPOSURE_MIDDLE_GREY) -
        0.5 * Math.log((1 + toeBalance) / (1 - toeBalance)) * (toeScale / slope)
  const straightMatch = (1 - toe) / slope - toeMatch
  const shoulderMatch = s.filmShoulder / slope - straightMatch
  return {
    slope,
    blackClip: black,
    whiteClip: white,
    toeScale,
    shoulderScale,
    toeMatch,
    straightMatch,
    shoulderMatch,
    /** Whether the shoulder lies under the toe in log luminance, which turns the weight of the
     *  blend between them. */
    turned: shoulderMatch < toeMatch,
    blueCorrection: s.blueCorrection,
    expandGamut: s.expandGamut,
    curveAmount: s.toneCurveAmount,
  }
}
/** The film curve of the settings `s` (`filmCurveOf`). */
export type FilmCurve = ReturnType<typeof filmCurveOf>

/** The film's constants and the curve of its default settings: what the curve at no setting
 *  (`filmicCurve`) reads, and the fixed numbers every curve does. The reference's own: the
 *  desaturations before and after the curve and the numbers of the glow and of the red modifier are
 *  fixed, no setting of it. */
export const FILM = {
  ...filmCurveOf(resolveSettings(COLOR_GRADING_RULES, {})),
  preDesaturate: 0.96,
  postDesaturate: 0.93,
  /** The glow a dark saturated colour takes, its gain and the lightness it fades out at twice
   *  of; the red modifier's scale, pivot and width, in degrees of hue. */
  glow: { gain: 0.05, middle: 0.08 },
  red: { scale: 0.82, pivot: 0.03, width: 135 },
  /** The matrices as numbers, column after column, for the code on the processor that follows the
   *  chain (the white balance, the grain's luminance weights, the standard output transform). */
  numbers: {
    workingToSrgb: AP1_TO_SRGB,
    luma: LUMA_AP1,
    /** The working gamut, sRGB's, to and from XYZ: the white balance's adaptation. */
    srgbToXyz: SRGB_TO_XYZ,
    xyzToSrgb: XYZ_TO_SRGB,
    /** The grading gamuts to XYZ: the standard output transform's input (`aces/acesCam.ts`). */
    ap0ToXyz: AP0_TO_XYZ,
    ap1ToXyz: AP1_TO_XYZ,
  },
  /** The same as WGSL matrices, and the luminance row as a `vec3f`, the shader's text. */
  wgsl: {
    srgbToWorking: wgslMatrix3(SRGB_TO_AP1),
    workingToSrgb: wgslMatrix3(AP1_TO_SRGB),
    gradingToWorking: wgslMatrix3(AP0_TO_AP1),
    workingToGrading: wgslMatrix3(AP1_TO_AP0),
    blue: wgslMatrix3(BLUE_AP1),
    blueBack: wgslMatrix3(BLUE_BACK_AP1),
    expand: wgslMatrix3(EXPAND_AP1),
    ap1ToXyz: wgslMatrix3(AP1_TO_XYZ),
    xyzToAp1: wgslMatrix3(XYZ_TO_AP1),
    xyzToSrgb: wgslMatrix3(XYZ_TO_SRGB),
    luma: wgslVec3(LUMA_AP1),
  },
} as const

/** The base-ten logarithm of a number of the shader: `log2 · LOG10_OF_2`. */
export const LOG10_OF_2 = Math.log10(2)
