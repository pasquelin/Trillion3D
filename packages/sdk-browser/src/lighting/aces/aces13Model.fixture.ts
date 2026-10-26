/**
 * The first version of the standard output transform (`aces13Wgsl.ts`) on the processor, in double
 * precision, from the published code's own steps and numbers, none taken from the engine's: the
 * oracle the shipped shader is held to, and the derivation of the tone scale's numbers
 * (`scaleOf`) that the shader holds as constants. The matrices are the published ones, written
 * row after row.
 */
import { clamp, mix } from '../../../../math/src/scalar/reals.ts'
import { multiply3 } from '../../../../math/src/matrix/matrix3.ts'
import { fromRows } from '../filmCurveConstants.ts'
import { times3, type V3 } from '../triple.ts'

const AP0_TO_AP1 = fromRows([
  1.4514393161, -0.2365107469, -0.2149285693, -0.0765537734, 1.1762296998, -0.0996759264,
  0.0083161484, -0.0060324498, 0.9977163014,
])
const AP1_TO_AP0 = fromRows([
  0.6954522414, 0.1406786965, 0.1638690622, 0.0447945634, 0.8596711185, 0.0955343182, -0.0055258826,
  0.0040252103, 1.0015006723,
])
const AP1_TO_XYZ = fromRows([
  0.6624541811, 0.1340042065, 0.156187687, 0.2722287168, 0.6740817658, 0.0536895174, -0.0055746495,
  0.0040607335, 1.0103391003,
])
const XYZ_TO_AP1 = fromRows([
  1.6410233797, -0.3248032942, -0.2364246952, -0.6636628587, 1.6153315917, 0.0167563477,
  0.0117218943, -0.008284442, 0.9883948585,
])
const XYZ_TO_SRGB = fromRows([
  3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574,
  0.0556300797, -0.2039769589, 1.0569715142,
])
const D60_TO_D65 = fromRows([
  0.9872240087, -0.0061132286, 0.0159532883, -0.0075983718, 1.0018614847, 0.0053300358,
  0.0030725771, -0.0050959615, 1.0816806031,
])
const AP1_TO_SRGB = multiply3(XYZ_TO_SRGB, multiply3(D60_TO_D65, AP1_TO_XYZ))
const AP1_LUMA: V3 = [0.2722287168, 0.6740817658, 0.0536895174]
const HALF_MAX = 65504
const HALF_INFINITY = 65535

/** The stops and luminances the tone scale's end points are looked up by. */
const MIN_STOP_RRT = -15
const MAX_STOP_RRT = 18
const MIN_STOP_SDR = -6.5
const MAX_STOP_SDR = 6.5
const MIN_LUM_RRT = 0.0001
const MAX_LUM_RRT = 10000
const MIN_LUM_SDR = 0.02
const MAX_LUM_SDR = 48

type Point = { x: number; y: number; slope: number }
export type Scale = { min: Point; mid: Point; max: Point; low: number[]; high: number[] }
const M1 = [
  [0.5, -1, 0.5],
  [-1, 1, 0.5],
  [0.5, 0, 0],
]
/** The three coefficients `cf` as the quadratic `[a, b, c]` of the parameter `t`: `cf` times `M1`. */
const quadratic = (cf: number[]) =>
  [0, 1, 2].map((i) => cf[0] * M1[0][i] + cf[1] * M1[1][i] + cf[2] * M1[2][i])

/** `value` in the table of two points `[x0, y0], [x1, y1]`, between them. */
const interpolate = (table: number[][], value: number) =>
  mix(table[0][1], table[1][1], clamp((value - table[0][0]) / (table[1][0] - table[0][0]), 0, 1))
const lookupMin = (nits: number) =>
  0.18 *
  2 **
    interpolate(
      [
        [Math.log10(MIN_LUM_RRT), MIN_STOP_RRT],
        [Math.log10(MIN_LUM_SDR), MIN_STOP_SDR],
      ],
      Math.log10(nits),
    )
const lookupMax = (nits: number) =>
  0.18 *
  2 **
    interpolate(
      [
        [Math.log10(MAX_LUM_SDR), MAX_STOP_SDR],
        [Math.log10(MAX_LUM_RRT), MAX_STOP_RRT],
      ],
      Math.log10(nits),
    )
const ends = (point: Point, half: number) => [
  point.slope * (Math.log10(point.x) - half) +
    (Math.log10(point.y) - point.slope * Math.log10(point.x)),
  point.slope * (Math.log10(point.x) + half) +
    (Math.log10(point.y) - point.slope * Math.log10(point.x)),
]

/** The tone scale for a display whose least, middle-grey and greatest luminances are `minNits`,
 *  `midNits` and `maxNits`, its exposure shifted by `shiftStops`. */
function paramsOf(minNits: number, maxNits: number, shiftStops = 0): Scale {
  const [lo, mid, hi] = [
    { x: lookupMin(minNits), y: minNits, slope: 0 },
    { x: 0.18, y: 4.8, slope: 1.55 },
    { x: lookupMax(maxNits), y: maxNits, slope: 0 },
  ]
  const lowStep = (Math.log10(mid.x) - Math.log10(lo.x)) / 3
  const highStep = (Math.log10(hi.x) - Math.log10(mid.x)) / 3
  const [low0, low1] = ends(lo, 0.5 * lowStep)
  const [low3, low4] = ends(mid, 0.5 * lowStep)
  const bendLow = interpolate(
    [
      [MIN_STOP_RRT, 0.18],
      [MIN_STOP_SDR, 0.35],
    ],
    Math.log2(lo.x / 0.18),
  )
  const [high0, high1] = ends(mid, 0.5 * highStep)
  const [high3, high4] = ends(hi, 0.5 * highStep)
  const bendHigh = interpolate(
    [
      [MAX_STOP_SDR, 0.89],
      [MAX_STOP_RRT, 0.9],
    ],
    Math.log2(hi.x / 0.18),
  )
  const shift = (x: number) => 2 ** (Math.log2(x) - shiftStops)
  const low2 = Math.log10(lo.y) + bendLow * (Math.log10(mid.y) - Math.log10(lo.y))
  const high2 = Math.log10(mid.y) + bendHigh * (Math.log10(hi.y) - Math.log10(mid.y))
  return {
    min: { ...lo, x: shift(lo.x) },
    mid: { ...mid, x: shift(mid.x) },
    max: { ...hi, x: shift(hi.x) },
    low: [low0, low1, low2, low3, low4, low4],
    high: [high0, high1, high2, high3, high4, high4],
  }
}

/** The light the tone scale `c` gives the luminance `y`: the scale undone. */
function inverseScale(y: number, c: Scale) {
  const log = Math.log10(Math.max(y, 1e-10))
  const lowStep = (Math.log10(c.mid.x) - Math.log10(c.min.x)) / 3
  const highStep = (Math.log10(c.max.x) - Math.log10(c.mid.x)) / 3
  const knotsY = (coefs: number[]) => [0, 1, 2, 3].map((i) => (coefs[i] + coefs[i + 1]) / 2)
  const solve = (coefs: number[], j: number, first: number, step: number) => {
    const [a, b, c0] = quadratic(coefs.slice(j, j + 3))
    const cc = c0 - log
    const t = (2 * cc) / (-Math.sqrt(b * b - 4 * a * cc) - b)
    return first + (t + j) * step
  }
  let logx: number
  if (log <= Math.log10(c.min.y)) logx = Math.log10(c.min.x)
  else if (log <= Math.log10(c.mid.y)) {
    const k = knotsY(c.low)
    const j = log <= k[1] ? 0 : log <= k[2] ? 1 : 2
    logx = solve(c.low, j, Math.log10(c.min.x), lowStep)
  } else if (log < Math.log10(c.max.y)) {
    const k = knotsY(c.high)
    const j = log <= k[1] ? 0 : log <= k[2] ? 1 : 2
    logx = solve(c.high, j, Math.log10(c.mid.x), highStep)
  } else logx = Math.log10(c.max.x)
  return 10 ** logx
}

/** The tone scale's numbers for a display of `minNits`, `midNits` and `maxNits`: the scale, shifted
 *  so that middle grey lands on the middle luminance. */
export function scaleOf(minNits: number, midNits: number, maxNits: number): Scale {
  const unshifted = paramsOf(minNits, maxNits)
  return paramsOf(minNits, maxNits, Math.log2(inverseScale(midNits, unshifted)) - Math.log2(0.18))
}

/** The luminance, in nits, the scale `c` gives the light `x`. */
export function scaleAt(x: number, c: Scale) {
  const logx = Math.log10(Math.max(x, 1e-10))
  let logy: number
  const spline = (coefs: number[], first: number, last: number) => {
    const coord = (3 * (logx - first)) / (last - first)
    const j = Math.trunc(coord)
    const [a, b, c0] = quadratic(coefs.slice(j, j + 3))
    const t = coord - j
    return t * t * a + t * b + c0
  }
  if (logx <= Math.log10(c.min.x)) logy = Math.log10(c.min.y)
  else if (logx < Math.log10(c.mid.x))
    logy = spline(c.low, Math.log10(c.min.x), Math.log10(c.mid.x))
  else if (logx < Math.log10(c.max.x))
    logy = spline(c.high, Math.log10(c.mid.x), Math.log10(c.max.x))
  else logy = Math.log10(c.max.y)
  return 10 ** logy
}

/** The cubic spline of the hue `x` degrees from the red, 135 degrees wide, 1.5 at its top. */
function hueWeight(x: number) {
  const width = 135
  if (!(x > -0.5 * width && x < 0.5 * width)) return 0
  const coord = ((x + 0.5 * width) * 4) / width
  const j = Math.trunc(coord)
  const t = coord - j
  const m = [
    [-1 / 6, 3 / 6, -3 / 6, 1 / 6],
    [3 / 6, -6 / 6, 3 / 6, 0],
    [-3 / 6, 0, 3 / 6, 0],
    [1 / 6, 4 / 6, 1 / 6, 0],
  ]
  const column = 3 - j
  const monomials = [t * t * t, t * t, t, 1]
  return 1.5 * monomials.reduce((sum, v, row) => sum + v * m[row][column], 0)
}

/** The rendering's sweeteners of the colour `aces` of the colour encoding's primaries: the glow, the
 *  red modifier, the colour taken to the rendering primaries and desaturated. */
function sweeteners(aces: V3): V3 {
  const [r, g, b] = aces
  const high = Math.max(r, g, b),
    low = Math.min(r, g, b)
  const saturation = (Math.max(high, 1e-10) - Math.max(low, 1e-10)) / Math.max(high, 1e-2)
  const chroma = Math.sqrt(Math.max(b * (b - g) + g * (g - r) + r * (r - b), 0))
  const yc = (b + g + r + 1.75 * chroma) / 3
  const x = (saturation - 0.4) / 0.2
  const t = Math.max(1 - Math.abs(0.5 * x), 0)
  const gain = 0.05 * 0.5 * (1 + Math.sign(x) * (1 - t * t))
  const middle = 0.08
  const glow = yc <= (2 / 3) * middle ? gain : yc >= 2 * middle ? 0 : gain * (middle / yc - 0.5)
  const lit = aces.map((c) => c * (1 + glow)) as V3
  let hue =
    lit[0] === lit[1] && lit[1] === lit[2]
      ? 0
      : (180 / Math.PI) * Math.atan2(Math.sqrt(3) * (lit[1] - lit[2]), 2 * lit[0] - lit[1] - lit[2])
  if (hue < 0) hue += 360
  hue = clamp(hue, 0, 360)
  if (hue < -180) hue += 360
  else if (hue > 180) hue -= 360
  lit[0] += hueWeight(hue) * saturation * (0.03 - lit[0]) * (1 - 0.82)
  const clamped = lit.map((c) => clamp(c, 0, HALF_INFINITY)) as V3
  const rendering = times3(AP0_TO_AP1, clamped).map((c) => clamp(c, 0, HALF_MAX))
  const luma = rendering[0] * AP1_LUMA[0] + rendering[1] * AP1_LUMA[1] + rendering[2] * AP1_LUMA[2]
  return rendering.map((c) => mix(luma, c, 0.96)) as V3
}

/** The colour `aces` with its distance from the achromatic axis compressed (the gamut compression). */
function compressed(aces: V3): V3 {
  const ap1 = times3(AP0_TO_AP1, aces)
  const largest = Math.max(...ap1)
  if (largest < 1e-10 || aces.some((c) => c < 0)) return aces
  const limit = [1.147, 1.264, 1.312],
    threshold = [0.815, 0.803, 0.88],
    power = 1.2
  const out = ap1.map((c, i) => {
    const dist = (largest - c) / Math.abs(largest)
    if (dist < threshold[i]) return largest - dist * Math.abs(largest)
    const scale =
      (limit[i] - threshold[i]) /
      (((1 - threshold[i]) / (limit[i] - threshold[i])) ** -power - 1) ** (1 / power)
    const nd = (dist - threshold[i]) / scale
    const squeezed = threshold[i] + (scale * nd) / (1 + nd ** power) ** (1 / power)
    return largest - squeezed * Math.abs(largest)
  })
  return times3(AP1_TO_AP0, out)
}

/** The linear sRGB colour in [0, 1] the display shows for the grading-gamut light `light` times
 *  `multiplier`, the gamut compression applied by the share `compression`: the published steps, in
 *  order, for the display of the scale `scale` (the default: 10⁻⁴, 15 and 1000 nits). */
export function aces13Display(
  light: readonly number[],
  multiplier: number,
  compression: number,
  scale = scaleOf(1e-4, 15, 1000),
): V3 {
  let aces = times3(
    AP1_TO_AP0,
    light.map((c) => c * multiplier),
  )
  const squeezed = compressed(aces)
  aces = aces.map((c, i) => mix(c, squeezed[i], compression)) as V3
  const post = sweeteners(aces).map((x) => scaleAt(x, scale))
  const share = post.map((y) => (y - scale.min.y) / (scale.max.y - scale.min.y))
  const limit = times3(XYZ_TO_AP1, times3(AP1_TO_XYZ, share)).map((c) => clamp(c, 0, 1))
  const display = times3(XYZ_TO_AP1, times3(AP1_TO_XYZ, limit)).map((c) =>
    clamp(c, 0, HALF_INFINITY),
  )
  const nits = display.map((c) => clamp(c * scale.max.y, 0, HALF_INFINITY))
  return times3(AP1_TO_SRGB, nits).map((c) => clamp(c * 0.01, 0, 1)) as V3
}
