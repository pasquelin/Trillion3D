// The triangle and slab rewrites against their before-forms (`triangleSlabBefore.fixture.ts`): on
// swept and hostile corners, degenerate triangles (a repeated corner, collinear corners), every
// sink, offsets and `out` as the corners, and on rays with zero and hostile direction components,
// every value keeps its bits.
import assert from 'node:assert/strict'
import test from 'node:test'
import { slabCut } from './slab.ts'
import { triangleArea, triangleCross } from './triangle.ts'
import {
  slabCutBefore,
  triangleAreaBefore,
  triangleCrossBefore,
} from './triangleSlabBefore.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, SINKS, sweepInput } from '../sequence/moves.fixture.ts'

/** Case `i`'s `count` swept values from slot `at` on `[−50, 50)`, hostile values mixed in. */
const swept = (i: number, at: number, count: number) =>
  Float64Array.from({ length: count }, (_, k) => sweepInput(i, at + k, 2, -50, 50))

/** Case `i`'s twelve corner values: four swept corners, or one in three, a degenerate set — the
 *  third corner on the line of the first two, `a + 2(b − a)`, the fourth the first again. */
function corners(i: number) {
  const v = swept(i, 0, 12)
  if (i % 3 === 0)
    for (let k = 0; k < 3; k++) {
      v[6 + k] = v[k] + 2 * (v[3 + k] - v[k])
      v[9 + k] = v[k]
    }
  return v
}

/** The corner triples: distinct, repeated, collinear, overlapping (a corner read across two). */
const TRIPLES = [
  [0, 3, 6],
  [3, 6, 9],
  [0, 3, 9],
  [0, 0, 3],
  [3, 3, 3],
  [0, 3, 0],
  [1, 4, 7],
  [9, 0, 2],
]

/** The sinks of a geometry output: doubles, floats, plain. */
const OUTPUTS = SINKS.slice(0, 3)

test('triangleCross, triangleArea: the corners and edges in locals keep every bit', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const v = corners(i)
    for (const [a, b, c] of TRIPLES) {
      for (const make of OUTPUTS) {
        const o = (i + a) % 4
        const old = make(new Float64Array(7).fill(7)),
          now = make(new Float64Array(7).fill(7))
        assert.equal(triangleCrossBefore(old, o, v, a, b, c), old)
        assert.equal(triangleCross(now, o, v, a, b, c), now)
        assertSameBits(old, now, `cross ${i} ${a}/${b}/${c}`)
      }
      const area = triangleAreaBefore(v, a, b, c),
        now = triangleArea(v, a, b, c)
      if (!Object.is(area, now)) assert.fail(`area ${i} ${a}/${b}/${c}: old ${area}, new ${now}`)
      // `out` as the corners, at an offset that overwrites a corner read later.
      const o = (i * 7 + b) % 10
      const oldV = v.slice(),
        nowV = v.slice()
      triangleCrossBefore(oldV, o, oldV, a, b, c)
      triangleCross(nowV, o, nowV, a, b, c)
      assertSameBits(oldV, nowV, `cross out = v ${i} ${a}/${b}/${c} o ${o}`)
    }
  }
})

/** A direction component: swept, or one in four a zero of either sign. */
const direction = (i: number, k: number) =>
  (i + k) % 4 === 0 ? ((i >> 2) & 1 ? -0 : 0) : sweepInput(i, 40 + k, 3, -2, 2)

test('slabCut: the swap through a local keeps the span and the verdict', () => {
  let kept = 0
  for (let i = 1; i <= HALTON_SWEEP * 4; i++) {
    const box = swept(i, 0, 8),
      o = swept(i, 10, 3),
      d = Float64Array.from({ length: 3 }, (_, k) => direction(i, k))
    const lowAt = i % 2,
      highAt = 3 + ((i >> 1) % 3)
    // Every other box ordered, so rays cross it and spans are kept.
    if (i % 2 === 0)
      for (let k = 0; k < 3; k++)
        if (box[lowAt + k] > box[highAt + k]) {
          const t = box[lowAt + k]
          box[lowAt + k] = box[highAt + k]
          box[highAt + k] = t
        }
    // One ray in four starts at the box's centre: it is inside on every axis, even along a face.
    if (i % 4 === 0) for (let k = 0; k < 3; k++) o[k] = (box[lowAt + k] + box[highAt + k]) / 2
    // One in four on a lower face: the quotient there is a zero whose sign the swap carries.
    else if (i % 4 === 1) o[i % 3] = box[lowAt + (i % 3)]
    const near = i % 3 ? -Infinity : sweepInput(i, 20, 5, -100, 100),
      far = i % 5 ? Infinity : sweepInput(i, 21, 7, -100, 100)
    const old = Float64Array.of(near, far),
      now = Float64Array.of(near, far)
    const verdict = slabCutBefore(old, box, lowAt, box, highAt, o, d)
    assert.equal(slabCut(now, box, lowAt, box, highAt, o, d), verdict, `verdict ${i}`)
    assertSameBits(old, now, `span ${i}`)
    if (verdict) kept++
  }
  assert.ok(kept > HALTON_SWEEP / 2, `the span was kept ${kept} times`)
})
