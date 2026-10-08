// Pseudo-random draws of the correctness campaigns: the two distributions every campaign draws
// from a generator of the math package (`lcgRandom`, `xorshiftRandom`).
import { lerp } from '../../../packages/math/src/scalar/reals.ts'

/**
 * The two distributions drawn from a generator: `between(a, b)` uniform on the interval, `log(a, b)`
 * uniform on a log scale — the one that covers the decades of a distance, a radius or an error
 * equally.
 */
export function lois(draw: () => number): {
  hasard: () => number
  between: (a: number, b: number) => number
  log: (a: number, b: number) => number
} {
  return {
    hasard: draw,
    between: (a: number, b: number) => lerp(a, b, draw()),
    log: (a: number, b: number) => a * (b / a) ** draw(),
  }
}
