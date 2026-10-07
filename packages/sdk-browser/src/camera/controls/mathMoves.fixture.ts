// What the controllers' length proofs (`mathMoves.test.ts`, `mathMovesLook.test.ts`) replay their
// gestures with: the old lengths, `hypot2`/`hypot3`, and the length rule's, `length2`/`length3`
// (#1493), and the sweep's host orientations.
import { hypot2, hypot3 } from '../../../../math/src/float/hypot.ts'
import { length2, length3 } from '../../../../math/src/vector/vector.ts'
import { normalizeQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import { haltonSpan } from '../../../../math/src/sequence/sweep.fixture.ts'

export type Lengths = {
  l2: (x: number, y: number) => number
  l3: (x: number, y: number, z: number) => number
}
export const OLD: Lengths = { l2: hypot2, l3: hypot3 },
  NEW: Lengths = { l2: length2, l3: length3 }

/** The `i`-th Halton unit quaternion, from bases 2, 3, 5 and 7. */
export function quaternion(i: number) {
  const q = new Float64Array(4)
  for (let k = 0; k < 4; k++) q[k] = haltonSpan(i, [2, 3, 5, 7][k], -1, 1)
  return normalizeQuaternion(q)
}
