// The current-frame filter's distance is `length2`, where it was `hypot2` (`filterWeights.ts`): the
// two can round a last bit apart. The weights reach the uniform in f32: on the sweep's jitters and
// their edges, over the whole pixel and past it, the nine weights keep their f32 bits.
import test from 'node:test'
import { taaWeights } from './filterWeights.ts'
import { hypot2 } from '../../../math/src/float/hypot.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'
import {
  assertSameFloat32,
  edgeValues,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'

/** The weights as they were written, `hypot2` their distance: the oracle. */
function oldWeights(jx: number, jy: number, out: Float32Array) {
  const window = (d: number) => {
    const x = saturate(d) * Math.PI + Math.PI
    return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x)
  }
  let sum = 0,
    k = 0
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++, k++) {
      const w = window(hypot2(dx - jx, dy + jy))
      out[k] = w
      sum += w
    }
  for (k = 0; k < 9; k++) out[k] /= sum
  return out
}

test('the filter weights keep their f32 bits with length2 for the distance', () => {
  const old = new Float32Array(12),
    now = new Float32Array(12)
  const edges = edgeValues(-1, 1)
  const check = (jx: number, jy: number) => {
    oldWeights(jx, jy, old)
    taaWeights(jx, jy, now, 0)
    for (let k = 0; k < 9; k++) assertSameFloat32(old[k], now[k], `(${jx}, ${jy}) weight ${k}`)
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) check(haltonSpan(i, 2, -1, 1), haltonSpan(i, 3, -1, 1))
  for (const jx of edges) for (const jy of edges) check(jx, jy)
})
