import type { Pin } from './graph.ts'
import { WiredGraph, type Wire } from './wired.ts'

/** The nodes that compute: arithmetic, rounding, trigonometry, vectors, choices. */
export class MathGraph extends WiredGraph {
  /** `a` + `b`; where one is not wired, its constant (0 and 1). */
  add(a: Wire, b: Wire) {
    return this.wire('add', { a, b })
  }
  /** `a` - `b` (1 and 1). */
  subtract(a: Wire, b: Wire) {
    return this.wire('subtract', { a, b })
  }
  /** `a` × `b` (0 and 1). */
  multiply(a: Wire, b: Wire) {
    return this.wire('multiply', { a, b })
  }
  /** `a` ÷ `b` (1 and 2). */
  divide(a: Wire, b: Wire) {
    return this.wire('divide', { a, b })
  }
  /** The smaller of `a` and `b` (0 and 1). */
  min(a: Wire, b: Wire) {
    return this.wire('min', { a, b })
  }
  /** The larger of `a` and `b` (0 and 1). */
  max(a: Wire, b: Wire) {
    return this.wire('max', { a, b })
  }
  /** `a` to `b` by `alpha` (0, 1 and 0.5). */
  lerp(a: Wire, b: Wire, alpha: Wire) {
    return this.wire('lerp', { a, b, alpha })
  }
  /** `base` to the power `exponent` (2); a base of at most 2.98e-8 (2^-25) counts as 0. A vector
   *  `exponent` of the base's width works on each component of it; a scalar one is repeated; two
   *  vectors of different widths are refused. */
  power(base: Pin, exponent?: Wire) {
    return this.wire('power', { base, exponent })
  }
  /** Clamps `input` between `min` (0) and `max` (1), or, by `mode`, only above `min` or below `max`. */
  clamp(input: Pin, min?: Wire, max?: Wire, mode: 'clamp' | 'min' | 'max' = 'clamp') {
    return this.wire('clamp', { input, min, max }, { mode })
  }
  /** `a` against `b`: greater gives `greater`, less gives `less`, equal within `threshold` gives
   *  `equal`, or whichever `greater` and `less` agree on when `equal` is not wired. */
  if(a: Pin, b: Wire, greater: Pin, equal: Pin | undefined, less: Pin, threshold = 0.00001) {
    return this.wire(
      'if',
      { a, b, aGreaterThanB: greater, aEqualsB: equal, aLessThanB: less },
      { equalsThreshold: threshold },
    )
  }
  /** The sine of `input`: `input` is in turns of `period` when `period` is above 0, in radians
   *  otherwise. */
  sine(input: Pin, period = 1) {
    return this.trig('sine', input, period)
  }
  /** The cosine of `input`, as `sine`. */
  cosine(input: Pin, period = 1) {
    return this.trig('cosine', input, period)
  }
  /** The tangent of `input`, as `sine`. */
  tangent(input: Pin, period = 1) {
    return this.trig('tangent', input, period)
  }
  private trig(kind: 'sine' | 'cosine' | 'tangent', input: Pin, period: number) {
    return this.addNode(kind, { period }, { input })
  }
  /** The angle in radians, from -π to π, of the point (`x`, `y`): the arctangent of `y` over `x`,
   *  the signs of both naming the quadrant. */
  arctangent2(y: Pin, x: Pin) {
    return this.addNode('arctangent2', {}, { y, x })
  }
  /** The remainder of `a` over `b`, of the sign of `a`; a vector `b` of the width of `a`, or a scalar
   *  `b`, works on each component of it. Where `a` and `b` are both known when the program is
   *  compiled (constants, parameters), a `b` under 1e-5 in magnitude is read as 1e-5, of its sign. */
  fmod(a: Pin, b: Pin) {
    return this.addNode('fmod', {}, { a, b })
  }
  /** The square root; a negative `input` has none (NaN). */
  sqrt(input: Pin) {
    return this.addNode('sqrt', {}, { input })
  }
  /** e to the power `input`. */
  exp(input: Pin) {
    return this.addNode('exp', {}, { input })
  }
  /** 2 to the power `input`. */
  exp2(input: Pin) {
    return this.addNode('exp2', {}, { input })
  }
  /** The natural logarithm of `input`, above 0. */
  log(input: Pin) {
    return this.addNode('log', {}, { input })
  }
  /** The base-2 logarithm of `x`, above 0. */
  log2(x: Pin) {
    return this.addNode('log2', {}, { x })
  }
  /** The base-10 logarithm of `x`, above 0. */
  log10(x: Pin) {
    return this.addNode('log10', {}, { x })
  }
  /** -1 below 0, 1 above it, 0 at 0. */
  sign(input: Pin) {
    return this.addNode('sign', {}, { input })
  }
  /** The nearest whole number: a half goes up where the value is known when the program is compiled
   *  (a constant or a parameter), to the even one otherwise. */
  round(input: Pin) {
    return this.addNode('round', {}, { input })
  }
  /** The reflectance of a surface seen at a grazing angle: `pow(1 - max(0, normal · cameraVector),
   *  exponent)` scaled into the range from `baseReflectFraction` to 1. `normal` is the pixel's own
   *  normal where not wired; `exponent` is 5 and `baseReflectFraction` 0.04. */
  fresnel(options: { exponent?: Wire; baseReflectFraction?: Wire; normal?: Pin } = {}) {
    return this.wire('fresnel', options)
  }
  /** `input`, a colour of three components or a scalar, towards the grey of its luminance by `fraction`
   *  (a colour of three components; with no `fraction`, the grey itself, a scalar); `luminance` weighs
   *  the channels (the sRGB working space's by default). */
  desaturation(input: Pin, fraction?: Wire, luminance?: readonly [number, number, number]) {
    return this.wire('desaturation', { input, fraction }, luminance ? { luminance } : {})
  }
  /** `input` spread away from `pivot` (0.5) by `amount` (1): `(input - pivot) × amount + pivot`. */
  contrast(input: Pin, amount?: Wire, pivot?: Wire) {
    return this.wire('contrast', { input, amount, pivot })
  }
  /** The absolute value. */
  abs(input: Pin) {
    return this.addNode('abs', {}, { input })
  }
  /** `input` held between 0 and 1. */
  saturate(input: Pin) {
    return this.addNode('saturate', {}, { input })
  }
  /** 1 - `input`. */
  oneMinus(input: Pin) {
    return this.addNode('oneMinus', {}, { input })
  }
  /** The fractional part. */
  frac(input: Pin) {
    return this.addNode('frac', {}, { input })
  }
  /** The largest whole number not above `input`. */
  floor(input: Pin) {
    return this.addNode('floor', {}, { input })
  }
  /** The smallest whole number not below `input`. */
  ceil(input: Pin) {
    return this.addNode('ceil', {}, { input })
  }
  /** `input` as a vector of length 1. */
  normalize(input: Pin) {
    return this.addNode('normalize', {}, { input })
  }
  /** The length of `input`. */
  length(input: Pin) {
    return this.addNode('length', {}, { input })
  }
  /** The dot product. */
  dot(a: Pin, b: Pin) {
    return this.addNode('dot', {}, { a, b })
  }
  /** The cross product of two vectors of three components. */
  cross(a: Pin, b: Pin) {
    return this.addNode('cross', {}, { a, b })
  }
  /** `a` then `b` as one vector, four components at most. */
  appendVector(a: Pin, b: Pin) {
    return this.addNode('appendVector', {}, { a, b })
  }
  /** The components of `input` named in `mask` ('r', 'rg', 'rgb', 'a'…). */
  componentMask(input: Pin, mask: string) {
    const flags = Object.fromEntries([...'rgba'].map((c) => [c, mask.includes(c)]))
    return this.addNode('componentMask', flags, { input })
  }
}
