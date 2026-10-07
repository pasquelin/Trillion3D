/**
 * `Math.hypot` for exactly two, three and four numbers, written out in scaled form so it
 * equals `Math.hypot` to the last bit: the largest magnitude, Infinity before NaN, then a Kahan
 * sum of the squares divided by that magnitude, then `sqrt(sum) * max`. The Rust twin is `hypot`
 * of `packages/math/rust/src/js.rs`.
 *
 * Why: the optimising compiler does not inline the builtin, which boxes its arguments into an
 * array and returns a heap number (about 55 ns a call in a bench, whose ~1.5 ns side was a
 * plain `Math.sqrt`, not these helpers: their own cost was not timed). The
 * result is the builtin's to the bit (`hypot.test.ts`); the specification leaves `Math.hypot`
 * approximated, and these return the value Chrome and Node return.
 *
 * The Kahan sum is folded by hand: its first step is exact (the compensation stays 0 and the sum
 * is the first square), so only the second step's compensation reaches the third square, and
 * the third step's the fourth.
 */

/** The largest of three magnitudes, a NaN skipped as the builtin skips it (NaN compares false). */
function largest(ax: number, ay: number, az: number) {
  let max = 0
  if (ax > max) max = ax
  if (ay > max) max = ay
  if (az > max) max = az
  return max
}

/** `Math.hypot(x, y)`, bit for bit. */
export function hypot2(x: number, y: number): number {
  const ax = Math.abs(x),
    ay = Math.abs(y)
  const max = largest(ax, ay, 0)
  if (max === Infinity) return Infinity
  if (x !== x || y !== y) return NaN
  if (max === 0) return 0
  const a = ax / max,
    b = ay / max
  return Math.sqrt(a * a + b * b) * max
}

/** `Math.hypot(x, y, z)`, bit for bit. */
export function hypot3(x: number, y: number, z: number): number {
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z)
  const max = largest(ax, ay, az)
  if (max === Infinity) return Infinity
  if (x !== x || y !== y || z !== z) return NaN
  if (max === 0) return 0
  const a = ax / max,
    b = ay / max,
    c = az / max
  const sum = a * a + b * b
  // `(sum - a²) - b²`: what the rounding of `sum` lost, taken back from the third square.
  const compensation = sum - a * a - b * b
  return Math.sqrt(sum + (c * c - compensation)) * max
}

/** `Math.hypot(x, y, z, w)`, bit for bit: a quaternion's length. */
export function hypot4(x: number, y: number, z: number, w: number): number {
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z),
    aw = Math.abs(w)
  let max = largest(ax, ay, az)
  if (aw > max) max = aw
  if (max === Infinity) return Infinity
  if (x !== x || y !== y || z !== z || w !== w) return NaN
  if (max === 0) return 0
  const a = ax / max,
    b = ay / max,
    c = az / max,
    d = aw / max
  const sum = a * a + b * b,
    compensation = sum - a * a - b * b,
    summand = c * c - compensation,
    third = sum + summand
  // The third step's loss, `(third - sum) - summand`, taken back from the fourth square.
  return Math.sqrt(third + (d * d - (third - sum - summand))) * max
}
