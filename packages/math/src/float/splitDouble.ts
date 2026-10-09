import type { NumberSink } from '../matrix/matrix4.ts'

/**
 * A double coordinate written as TWO single-precision values: round-to-nearest, then what it
 * left. The sum of the two represents the original double to within an ulp squared, and that is
 * the only form in which corners and the anchor enter the kernel (`margins.ts`). The
 * two positions are given separately because the layouts differ: a corner stores its residue
 * three floats further, the uniform four. Into a `Float32Array` the low part rounds once more;
 * into a double sink it stays `value − high` exactly, the high part's residue.
 */
export function writeSplitDouble(out: NumberSink, highAt: number, lowAt: number, value: number) {
  const high = Math.fround(value)
  out[highAt] = high
  out[lowAt] = value - high
}

const rounded = new Float32Array(1),
  bits = new Uint32Array(rounded.buffer)

/** Smallest float not below value, including subnormals; bounds must never round inward. */
export function ceilFloat32(value: number) {
  // `Math.fround` is the nearest float; only when it lies below does the float buffer step it one
  // ulp up (away from zero for a positive, toward zero for a negative).
  const nearest = Math.fround(value)
  if (!(nearest < value)) return nearest
  rounded[0] = nearest
  bits[0] += nearest >= 0 ? 1 : -1
  return rounded[0]
}

/** Greatest float not above value, including subnormals and negative zero: `ceilFloat32` mirrored. */
export function floorFloat32(value: number) {
  // `ceilFloat32`'s form mirrored: the nearest float, stepped one ulp down only when it lies above.
  const nearest = Math.fround(value)
  if (!(nearest > value)) return nearest
  rounded[0] = nearest
  bits[0] += nearest > 0 ? -1 : 1
  return rounded[0]
}

/** Writes `count` of `values` from `from` — all of them by default — as doubles in the shaders'
 *  form (`../wgsl/double.ts`), high word then low word, from word `at`. */
export function packDoubles(
  out: Uint32Array,
  at: number,
  values: ArrayLike<number>,
  from = 0,
  count = values.length - from,
) {
  for (let k = 0; k < count; k++) {
    cell[0] = values[from + k]
    out[at + k * 2] = cellWords[1]
    out[at + k * 2 + 1] = cellWords[0]
  }
}
const cell = new Float64Array(1),
  cellWords = new Uint32Array(cell.buffer)
