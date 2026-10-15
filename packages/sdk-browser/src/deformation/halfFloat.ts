import { fromHalf, toHalf } from '../../../math/src/float/half.ts'
import { HALF_MAX } from '../../../math/src/constants.ts'

/** A half float's value from its sixteen bits, positive ones: what `unpack2x16float` reads. */
const halfValue = (bits: number) => (bits >= 0x7c00 ? Infinity : fromHalf(bits))

/** The smallest half float at or above `x`, as its sixteen bits: a reach the GPU cut reads never
 *  below the one the CPU cut grows by; past the largest finite half, infinity. */
function halfAtLeast(x: number) {
  if (!(x > 0)) return 0
  if (x > HALF_MAX) return 0x7c00
  // The nearest half is one of the two around `x`: the one below steps up to the one above.
  let bits = toHalf(x)
  while (halfValue(bits) < x) bits++
  return bits
}

/** THE MARK WORD A ROOT SENDS THE GPU CUT (`markWorld`): its `mark` with its deformation `reach`
 *  in the high sixteen bits, as the cut reads it (`reachOf`). Every sender builds it here: a word
 *  without the reach would shrink a deformed root's bounds on the GPU. */
export const rootMark = ({ mark = 0, reach = 0 }: { mark?: number; reach?: number }) =>
  ((mark & 0xffff) | (halfAtLeast(reach) << 16)) >>> 0
