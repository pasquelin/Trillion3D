/**
 * Math foundation colors: piecewise sRGB transfer curve as written across the repo
 * (thresholds 0.04045 and 0.0031308, slope 12.92, exponent 2.4), identical to
 * Rust compiler and WGSL composition. Reference 3D library rounds its
 * constants (`c · 0.0773993808`, `c · 0.9478672986 + 0.0521327014`): deviation is benchmarked in
 * `bench/perf/browser/core-math.perf.ts`, and it is not the decision maker here.
 */

import type { NumberSink } from '../matrix/matrix4.ts'
import { wrap, clamp, saturate } from '../scalar/reals.ts'

/** Encoded sRGB value in `[0, 1]` to its linear value. */
export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Linear value to its encoded sRGB value, negative numbers clamped to zero before exponent. */
export function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
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
