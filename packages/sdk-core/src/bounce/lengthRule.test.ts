// The length rule on the bounce cascades (docs/MATHS.md "Lengths"): the ray reach, the scene box's
// diagonal, moved from `hypot3` to `length3`. It is read only as the float32 of the cascades
// uniform (sdk-browser bounce/uniform.ts), so the proof is that float32, against the former
// expression, over Halton boxes of every size and the edges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createBounceCascades } from './cascades.ts'
import { BOUNCE_SETTINGS } from './contracts.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { halton } from '../../../math/src/sequence/halton.ts'

const N = 4096

/** The former reach: `hypot3` of the box's sides, times the reach fraction. */
const oldReach = (b: readonly number[]) =>
  hypot3(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * BOUNCE_SETTINGS.rayReachFraction

/** A box from the Halton terms of `i`: a corner anywhere within 1e4 m, sides of 1e-3 to 1e4 m. */
function box(i: number) {
  const corner = [2, 3, 5].map((base) => 2e4 * halton(i, base) - 1e4)
  const sides = [7, 11, 13].map((base) => 10 ** (7 * halton(i, base) - 3))
  return [...corner, ...corner.map((c, k) => c + sides[k])]
}

test('the ray reach is the float32 of the former diagonal, built and replanned', () => {
  const edges = [
    [0, 0, 0, 0, 0, 0],
    [-1, -2, -3, 1, 2, 3],
    [0, 0, 0, 3, 4, 12],
    [-0, 0, -0, 1e-3, 0, 0],
    [0, 0, 0, 1e6, 1e6, 1e6],
  ]
  const boxes = Array.from({ length: N }, (_, i) => box(i + 1)).concat(edges)
  const cascades = createBounceCascades(boxes[0])
  boxes.forEach((bounds, i) => {
    const built = createBounceCascades(bounds).reach,
      expected = Math.fround(oldReach(bounds))
    assert.ok(Object.is(Math.fround(built), expected), `box ${i}: ${built}`)
    cascades.replan(bounds)
    assert.ok(Object.is(Math.fround(cascades.reach), expected), `replan ${i}: ${cascades.reach}`)
  })
})
