/**
 * The display curves' constants (`toneMappingWgsl.ts`): the matrices as numbers, column after
 * column, written as WGSL matrices, and the curves' expressions as text. Each is the curve the
 * display pass evaluates.
 */
import { wgslF32, wgslMatrix3 } from '../../../math/src/wgsl/number.ts'
import { normalMatrix3 } from '../../../math/src/matrix/matrix3.ts'

/** The inverse of a column-major 3×3 matrix: the transpose of its normal matrix. */
function inverse3(m: readonly number[]) {
  const n = normalMatrix3(new Array<number>(9), [
    m[0],
    m[1],
    m[2],
    0,
    m[3],
    m[4],
    m[5],
    0,
    m[6],
    m[7],
    m[8],
    0,
  ])
  return [n[0], n[3], n[6], n[1], n[4], n[7], n[2], n[5], n[8]]
}
/** `a · b`, column-major 3×3. */
const multiply3 = (a: readonly number[], b: readonly number[]) =>
  Array.from({ length: 9 }, (_, i) => {
    const col = Math.floor(i / 3),
      row = i % 3
    return a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2]
  })

/** The filmic curve's rational fit, `(c(c + a) − b) / (c(d·c + e) + f)`. */
const ACES_FIT = { a: 0.0245786, b: 0.000090537, d: 0.983729, e: 0.432951, f: 0.238081 }
const ACES_INPUT = [0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777]
const ACES_OUTPUT = [
  1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602,
]
/** The filmic curve. declared: an exposure scale, two colour matrices around a rational fit of `c`,
 *  set together as one look. Sensitivity: each number shapes the tone and the colour of the whole
 *  image, so none is changed alone. */
export const ACES = {
  exposure: wgslF32(0.6),
  input: wgslMatrix3(ACES_INPUT),
  output: wgslMatrix3(ACES_OUTPUT),
  /** The two matrices' inverses, and the rational fit's coefficients as numbers: what the curve's
   *  inverse reads (`toneUnmap`). */
  inputInverse: wgslMatrix3(inverse3(ACES_INPUT)),
  outputInverse: wgslMatrix3(inverse3(ACES_OUTPUT)),
  fit: ACES_FIT,
  numerator: `c*(c+${ACES_FIT.a})-${ACES_FIT.b}`,
  denominator: `c*(${ACES_FIT.d}*c+${ACES_FIT.e})+${ACES_FIT.f}`,
}

const AGX_TO_WIDE = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956]
const AGX_TO_NARROW = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187]
const AGX_INSET = [
  0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591,
  0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859,
]
const AGX_OUTSET = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323,
  1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257,
  1.2519364065950405,
]
/** The log-domain curve. declared: a conversion to the BT.2020 primaries and back, an inset and an
 *  outset matrix, the log2 range in EV and a sixth-degree contrast fit over `c`, `c2 = c²`,
 *  `c4 = c⁴`, set together as one look. Sensitivity: each number shapes the tone and the colour of
 *  the whole image, so none is changed alone. */
export const AGX = {
  toWide: wgslMatrix3(AGX_TO_WIDE),
  toNarrow: wgslMatrix3(AGX_TO_NARROW),
  inset: wgslMatrix3(AGX_INSET),
  outset: wgslMatrix3(AGX_OUTSET),
  /** The inverses the curve's inverse reads (`toneUnmap`): of the narrowing, of the outset, and of
   *  the inset after the widening. */
  toNarrowInverse: wgslMatrix3(inverse3(AGX_TO_NARROW)),
  outsetInverse: wgslMatrix3(inverse3(AGX_OUTSET)),
  intoLogInverse: wgslMatrix3(inverse3(multiply3(AGX_INSET, AGX_TO_WIDE))),
  low: -12.47393,
  high: 4.026069,
  contrast: '15.5*c4*c2-40.14*c4*c+31.96*c4-6.868*c2*c+0.4298*c2+0.1191*c-0.00232',
}

/** The display gamma the filmic curves carry, which a power takes back to linear before the sRGB
 *  transfer (cineon, agx), and its inverse, for the curves' inverses. */
export const GAMMA = 2.2

/** The filmic rational fit of `x = max(0, c − 0.004)`, display gamma included:
 *  `x(a·x + b) / (x(a·x + c) + d)`. */
const CINEON_FIT = { a: 6.2, b: 0.5, c: 1.7, d: 0.06 }
export const CINEON = {
  offset: wgslF32(0.004),
  fit: CINEON_FIT,
  curve: `(x*(${CINEON_FIT.a}*x+${CINEON_FIT.b}))/(x*(${CINEON_FIT.a}*x+${CINEON_FIT.c})+${CINEON_FIT.d})`,
}

/** The neutral operator's numbers: its toe below `toeKnee`, lifted by `offset` where it ends, its
 *  knee, its shoulder from `shoulder` and its blend's `slope`. */
const NEUTRAL_FIT = {
  toeKnee: 0.08,
  toeScale: 6.25,
  offset: 0.04,
  knee: 0.76,
  shoulder: 0.52,
  shoulderRange: 0.0576,
  slope: 0.15,
}
/** The neutral operator: its toe below 0.08, its knee at 0.76, its shoulder. */
export const NEUTRAL = {
  fit: NEUTRAL_FIT,
  toe: `low<${NEUTRAL_FIT.toeKnee}`,
  toeOffset: `low-${NEUTRAL_FIT.toeScale}*low*low`,
  offset: wgslF32(NEUTRAL_FIT.offset),
  knee: wgslF32(NEUTRAL_FIT.knee),
  top: `1.0-${NEUTRAL_FIT.shoulderRange}/(peak-${NEUTRAL_FIT.shoulder})`,
  blend: `1.0-1.0/(${NEUTRAL_FIT.slope}*(peak-top)+1.0)`,
}
