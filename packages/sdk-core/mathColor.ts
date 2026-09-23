/**
 * Math foundation colors: piecewise sRGB transfer curve as written across the repo
 * (thresholds 0.04045 and 0.0031308, slope 12.92, exponent 2.4), identical to
 * Rust compiler and WGSL composition. Reference 3D library rounds its
 * constants (`c · 0.0773993808`, `c · 0.9478672986 + 0.0521327014`): deviation is benchmarked in
 * `bench/perf/browser/socle-math.perf.ts`, and it is not the decision maker here.
 */

import type { NumberSink } from './mathMatrix4.ts';

/** Encoded sRGB value in `[0, 1]` to its linear value. */
export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear value to its encoded sRGB value, negative numbers clamped to zero before exponent. */
export function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
}

/** Linear value to its encoded sRGB byte, rounded and held to `[0, 255]`. */
export function linearToSrgb8(c: number) {
  return Math.max(0, Math.min(255, Math.round(linearToSrgb(c) * 255)));
}

/** `t` wrapped into `[0, 1[` via reference Euclidean modulo: `((t % 1) + 1) % 1`. */
const wrapUnit = (t: number) => ((t % 1) + 1) % 1;

/** A component of HSL to RGB conversion, reference piecewise ramp. */
function hueComponent(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

/**
 * Hue, saturation, and lightness to three linear components written to `out[o..o+2]`.
 *
 * Reference `setHSL` term by term: wrapped hue, saturation and lightness clamped to
 * `[0, 1]`, zero saturation returned as gray, then piecewise ramp. No transfer curve
 * is applied — reference workspace is already linear, its conversion is
 * identity.
 */
export function hslToLinearRgb<T extends NumberSink>(
  out: T,
  o: number,
  h: number,
  s: number,
  l: number,
) {
  const hue = wrapUnit(h),
    saturation = Math.max(0, Math.min(1, s)),
    lightness = Math.max(0, Math.min(1, l));
  if (saturation === 0) {
    out[o] = out[o + 1] = out[o + 2] = lightness;
    return out;
  }
  const p =
      lightness <= 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation,
    q = 2 * lightness - p;
  out[o] = hueComponent(q, p, hue + 1 / 3);
  out[o + 1] = hueComponent(q, p, hue);
  out[o + 2] = hueComponent(q, p, hue - 1 / 3);
  return out;
}
