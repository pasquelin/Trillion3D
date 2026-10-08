import { copyMatrix4, determinantMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4Typed } from '../../../../math/src/matrix/matrix4Typed.ts'
import { crossVector3, normalizeVector3 } from '../../../../math/src/vector/vector.ts'

const bindBasis = new Float64Array(16),
  worldBasis = new Float64Array(16),
  inverse = new Float64Array(16)
/** Complete a represented planar bind with its normal; snapped off-plane residuals rotate too. */
function planeBasis(out: Float64Array, matrix: ArrayLike<number>, a: number, b: number) {
  copyMatrix4(out, matrix)
  for (let row = 0; row < 3; row++) {
    out[row] = matrix[a * 4 + row]
    out[row + 4] = matrix[b * 4 + row]
  }
  crossVector3(out, out, out, 8, 0, 4)
  normalizeVector3(out, 8)
}

/** Delta on an existing proxy surface, including a plane cooked with a flattened local axis. */
export function proxyAffineDelta(
  out: Float64Array,
  bind: Float64Array,
  world: ArrayLike<number>,
  bindInverse: Float64Array,
) {
  if (determinantMatrix4(bind) !== 0) return multiplyMatrix4Typed(out, world, bindInverse)
  let best = 0,
    first = 0,
    second = 1
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      planeBasis(bindBasis, bind, a, b)
      const area = Math.abs(determinantMatrix4(bindBasis))
      if (area > best) {
        best = area
        first = a
        second = b
      }
    }
  planeBasis(bindBasis, bind, first, second)
  planeBasis(worldBasis, world, first, second)
  invertMatrix4(inverse, bindBasis)
  return multiplyMatrix4Typed(out, worldBasis, inverse)
}
