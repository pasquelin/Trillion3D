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
  /** `base` to the power `exponent` (2); a negative base counts as 0. */
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
    return this.add2('sine', input, period)
  }
  /** The cosine of `input`, as `sine`. */
  cosine(input: Pin, period = 1) {
    return this.add2('cosine', input, period)
  }
  private add2(kind: 'sine' | 'cosine', input: Pin, period: number) {
    return this.addNode(kind, { period }, { input })
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
