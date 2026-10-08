// `ceilFloat32` and `floorFloat32` before they started from `Math.fround`, word for word but their
// names: the oracles `splitDoubleMoves.test.ts` holds the shipped ones to.

const rounded = new Float32Array(1),
  bits = new Uint32Array(rounded.buffer)

export function ceilFloat32Before(value: number) {
  rounded[0] = value
  if (rounded[0] < value) bits[0] += rounded[0] >= 0 ? 1 : -1
  return rounded[0]
}

export function floorFloat32Before(value: number) {
  rounded[0] = value
  if (rounded[0] > value) bits[0] += rounded[0] > 0 ? -1 : 1
  return rounded[0]
}
