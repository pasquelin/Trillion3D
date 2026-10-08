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
  rounded[0] = value
  if (rounded[0] < value) bits[0] += rounded[0] >= 0 ? 1 : -1
  return rounded[0]
}

/** Greatest float not above value, including subnormals and negative zero: `ceilFloat32` mirrored. */
export function floorFloat32(value: number) {
  rounded[0] = value
  if (rounded[0] > value) bits[0] += rounded[0] > 0 ? -1 : 1
  return rounded[0]
}
