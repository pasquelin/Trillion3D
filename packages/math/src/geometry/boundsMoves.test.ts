// The box and sphere rewrites against their before-forms (`boundsBefore.fixture.ts`): on the
// sweep's bounds and points, hostile values included, every matrix kind (perspectives among them),
// offsets and aliasing, every value keeps its bits.
import assert from 'node:assert/strict'
import test from 'node:test'
import { boxFromPoints, boxGrow, boxTransform } from './box.ts'
import { spheresOverlap } from './sphere.ts'
import {
  boxFromPointsBefore,
  boxGrowBefore,
  boxTransformBefore,
  spheresOverlapBefore,
} from './boundsBefore.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, MATRIX_KINDS, sweepInput, sweepMatrix } from '../sequence/moves.fixture.ts'

/** Sweep case `i`'s twelve values from slot `at`: on `[−50, 50)`, hostile values mixed in. */
const sweepValues = (i: number, at: number, count: number) =>
  Float64Array.from({ length: count }, (_, k) => sweepInput(i, at + k, 2, -50, 50))

/** A box of case `i` whose bounds are finite and ordered, so the affine path runs. */
function finiteBox(i: number) {
  const v = Float64Array.from({ length: 6 }, (_, k) => sweepInput(i, k + 1, 5, -50, 50))
  for (let k = 0; k < 6; k++) if (!Number.isFinite(v[k])) v[k] = k
  for (let k = 0; k < 3; k++) if (v[k + 3] < v[k]) [v[k], v[k + 3]] = [v[k + 3], v[k]]
  return v
}

test('boxGrow: six constant stores in the loop order, offsets and overlaps kept', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const g = sweepInput(i, 13, 3, -2, 2)
    for (const [o, bo] of [
      [0, 0],
      [2, 1],
      [1, 2],
      [0, 1],
      [1, 0],
    ]) {
      const box = sweepValues(i, 0, 9),
        old = new Float64Array(9).fill(7),
        now = new Float64Array(9).fill(7)
      boxGrowBefore(old, o, box, bo, g)
      boxGrow(now, o, box, bo, g)
      assertSameBits(old, now, `${i} ${o}/${bo}`)
      const oldBox = box.slice(),
        nowBox = box.slice()
      boxGrowBefore(oldBox, o, oldBox, bo, g)
      boxGrow(nowBox, o, nowBox, bo, g)
      assertSameBits(oldBox, nowBox, `${i} ${o}/${bo} in place`)
    }
  }
})

test('boxFromPoints: the bounds in locals keep every bit of the min/max fold', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const points = sweepValues(i, 0, 48)
    const count = [0, 1, 2, 5, 9, -1, NaN, 2.5][i % 8],
      stride = [3, 4, 5][i % 3],
      at = i % 4,
      o = (i >> 2) % 3
    const old = new Float64Array(9).fill(7),
      now = new Float64Array(9).fill(7)
    boxFromPointsBefore(old, o, points, at, count, stride)
    boxFromPoints(now, o, points, at, count, stride)
    assertSameBits(old, now, `${i}`)
  }
})

test('boxTransform: w is skipped only where it is exactly 1', () => {
  const m = new Float64Array(16)
  let affine = 0
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(m, i, kind)
      for (const box of [sweepValues(i, 20, 8), finiteBox(i)]) {
        const o = i % 3,
          bo = (i >> 1) % 3
        const oldBox = new Float64Array(9).fill(7),
          nowBox = new Float64Array(9).fill(7)
        boxTransformBefore(oldBox, o, box, bo, m)
        boxTransform(nowBox, o, box, bo, m)
        assertSameBits(oldBox, nowBox, `transform ${i} kind ${kind}`)
        const oldIn = box.slice(),
          nowIn = box.slice()
        boxTransformBefore(oldIn, bo, oldIn, bo, m)
        boxTransform(nowIn, bo, nowIn, bo, m)
        assertSameBits(oldIn, nowIn, `transform in place ${i} kind ${kind}`)
        if (kind === 1 && box.every(Number.isFinite)) affine++
      }
    }
  assert.ok(affine > HALTON_SWEEP / 2, `the affine path ran ${affine} times`)
})

test('spheresOverlap: the squared distance in place, at every offset', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = sweepValues(i, 0, 6),
      b = sweepValues(i, 6, 6)
    const ar = sweepInput(i, 30, 3, -1, 60),
      br = sweepInput(i, 31, 5, -1, 60)
    for (const [aAt, bAt] of [
      [0, 0],
      [1, 2],
      [3, 0],
    ]) {
      const old = spheresOverlapBefore(a, ar, b, br, aAt, bAt)
      assert.equal(spheresOverlap(a, ar, b, br, aAt, bAt), old, `${i} ${aAt}/${bAt}`)
    }
    assert.equal(spheresOverlap(a, ar, b, br), spheresOverlapBefore(a, ar, b, br), `${i}`)
  }
})
