// The shadow rows' lengths moved from `hypot3` (Math.hypot to the bit) to `length3`, the old
// expression the oracle: a row's object radius (`rowLodWords.ts`), half the world box's diagonal,
// written to float32. The two lengths are one last bit of a double apart; the sweep holds the
// float32 the buffer receives equal. Inputs stay inside float32's range, where `length3`'s squares
// neither overflow nor underflow.
import test from 'node:test'
import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'

test("a row's object radius writes the same float32", () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const [dx, dy, dz] = [2, 3, 5].map((b) => haltonSpan(i, b, 0, 2e4))
    assertSameFloat32(0.5 * Math.hypot(dx, dy, dz), 0.5 * length3(dx, dy, dz), `row ${i}`)
  }
  for (const e of edgeValues(0, 1e30))
    assertSameFloat32(0.5 * Math.hypot(e, 0, e), 0.5 * length3(e, 0, e), `edge ${e}`)
})
