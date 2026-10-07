// The shadow rows' lengths moved from `hypot3` (Math.hypot to the bit) to `length3`, the old
// expression the oracle: a cluster sphere's radius (`spheres.ts`), rounded up to float32 after its
// centre's split error is added, and a row's object radius (`rowLodWords.ts`), half the world
// box's diagonal, written to float32. The two lengths are one last bit of a double apart; the
// sweep holds the float32 each buffer receives equal. Inputs stay inside float32's range, where
// `length3`'s squares neither overflow nor underflow.
import test from 'node:test'
import { ceilFloat32 } from '../../../../math/src/float/splitDouble.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'

test("a cluster sphere's radius rounds up to the same float32", () => {
  // The three overestimated extents |e|·h summed per world axis, then the centre's split error.
  const radius = (x: number, y: number, z: number, error: number, len: typeof length3) =>
    ceilFloat32(len(x, y, z) + Math.sqrt(error))
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [x, y, z] = [2, 3, 5].map((b) => haltonSpan(i, b, 0, 5e3))
    const error = haltonSpan(i, 7, 0, 1e-8)
    assertSameFloat32(
      radius(x, y, z, error, Math.hypot),
      radius(x, y, z, error, length3),
      `cluster ${i}`,
    )
  }
  for (const e of edgeValues(0, 1e30))
    for (const error of [0, 1e-12])
      assertSameFloat32(
        radius(e, e, 0, error, Math.hypot),
        radius(e, e, 0, error, length3),
        `edge ${e}`,
      )
})

test("a row's object radius writes the same float32", () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [dx, dy, dz] = [2, 3, 5].map((b) => haltonSpan(i, b, 0, 2e4))
    assertSameFloat32(0.5 * Math.hypot(dx, dy, dz), 0.5 * length3(dx, dy, dz), `row ${i}`)
  }
  for (const e of edgeValues(0, 1e30))
    assertSameFloat32(0.5 * Math.hypot(e, 0, e), 0.5 * length3(e, 0, e), `edge ${e}`)
})
