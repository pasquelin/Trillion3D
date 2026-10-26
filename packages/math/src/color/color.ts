/**
 * Math foundation colors: piecewise sRGB transfer curve as written across the repo
 * (thresholds 0.04045 and 0.0031308, slope 12.92, exponent 2.4), identical to
 * Rust compiler and WGSL composition: the exact constants, never rounded ones.
 */

import type { NumberSink } from '../matrix/matrix4.ts'
import { wrap, clamp, saturate } from '../scalar/reals.ts'

/** The transfer curve's constants, which the WGSL twins read (`../wgsl/color.ts`): the decode's and
 *  the encode's thresholds, the slope of the linear part, the power's scale, offset and exponent. */
export const SRGB_DECODE_THRESHOLD = 0.04045
export const SRGB_ENCODE_THRESHOLD = 0.0031308
export const SRGB_SLOPE = 12.92
export const SRGB_SCALE = 1.055
export const SRGB_OFFSET = 0.055
export const SRGB_GAMMA = 2.4

/** The luminance of a linear colour: the weights of its channels, the Y row of the sRGB (Rec. 709
 *  primaries, D65) to XYZ matrix, the working space's own, which the WGSL twin reads. */
export const SRGB_LUMINANCE = [0.2126390059, 0.7151686788, 0.0721923154] as const

type Vec3 = readonly [number, number, number]
type Mat3 = readonly [Vec3, Vec3, Vec3]

/** The inverse of a 3×3 matrix by cofactors, rows as written. */
const inverseRows = (m: Mat3): Mat3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

/** A row vector times a matrix. */
export const rowTimes = (v: Vec3, m: Mat3): Vec3 => [
  v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
  v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
  v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2],
]

/** The XYZ to linear sRGB matrix, rows as written, derived from the chromaticities (x, y) of the
 *  sRGB primaries (0.64, 0.33), (0.3, 0.6), (0.15, 0.06) and of the D65 white (0.3127, 0.329):
 *  each primary's row (x, y, z) is scaled so that white (1, 1, 1) lands on the white point at
 *  luminance 1, then inverted. The film curve's matrices are the published table's, not these. */
export const XYZ_TO_SRGB: Mat3 = /* @__PURE__ */ (() => {
  const row = ([x, y]: readonly [number, number]): Vec3 => [x, y, 1 - x - y]
  const primaries: Mat3 = [row([0.64, 0.33]), row([0.3, 0.6]), row([0.15, 0.06])]
  const [wx, wy] = [0.3127, 0.329]
  const scale = rowTimes([wx / wy, 1, (1 - wx - wy) / wy], inverseRows(primaries))
  return inverseRows(primaries.map((r, i) => r.map((x) => x * scale[i]!)) as unknown as Mat3)
})()

/** Encoded sRGB value in `[0, 1]` to its linear value. */
export function srgbToLinear(c: number) {
  return c <= SRGB_DECODE_THRESHOLD
    ? c / SRGB_SLOPE
    : Math.pow((c + SRGB_OFFSET) / SRGB_SCALE, SRGB_GAMMA)
}

/** Linear value to its encoded sRGB value, negative numbers clamped to zero before exponent. */
export function linearToSrgb(c: number) {
  return c <= SRGB_ENCODE_THRESHOLD
    ? SRGB_SLOPE * c
    : SRGB_SCALE * Math.pow(Math.max(c, 0), 1 / SRGB_GAMMA) - SRGB_OFFSET
}

/** A unit value to its byte: `clamp(Math.round(x · 255), 0, 255)`, the unorm8 encoding. */
export const unorm8 = (x: number) => clamp(Math.round(x * 255), 0, 255)

/** A unorm8 byte to its unit value, `b / 255`: exact at 0 and 255, and `unorm8` takes it back. */
export const fromUnorm8 = (b: number) => b / 255

/** Linear value to its encoded sRGB byte: `unorm8` of `linearToSrgb`. */
export function linearToSrgb8(c: number) {
  return unorm8(linearToSrgb(c))
}

/** A component of HSL to RGB conversion, the piecewise ramp. */
function hueComponent(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t)
  return p
}

/**
 * Hue, saturation, and lightness to three RGB components written to `out[o..o+2]`.
 *
 * The hue is wrapped into `[0, 1[`, saturation and lightness are clamped to `[0, 1]`, zero
 * saturation gives a gray, otherwise a piecewise ramp gives each channel. The components come
 * out in the encoding the HSL is given in; no transfer curve is applied.
 */
export function hslToRgb<T extends NumberSink>(out: T, o: number, h: number, s: number, l: number) {
  const hue = wrap(h, 1),
    saturation = saturate(s),
    lightness = saturate(l)
  if (saturation === 0) {
    out[o] = out[o + 1] = out[o + 2] = lightness
    return out
  }
  const p =
      lightness <= 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation,
    q = 2 * lightness - p
  out[o] = hueComponent(q, p, hue + 1 / 3)
  out[o + 1] = hueComponent(q, p, hue)
  out[o + 2] = hueComponent(q, p, hue - 1 / 3)
  return out
}
