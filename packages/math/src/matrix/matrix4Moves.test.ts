// The matrix rewrites against their before-forms (`matrix4Before.fixture.ts`): on every matrix
// kind of the sweep, hostile entries included, read from and written into `Float64Array`,
// `Float32Array` and plain arrays, in place and at offsets, every value keeps its bits and nothing
// past the sixteen is written.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  copyMatrix4,
  linearPartDeterminant,
  multiplyMatrix4,
  negateColumnMatrix4,
  negateRowMatrix4,
  transposeMatrix4,
  type NumberSink,
} from './matrix4.ts'
import {
  copyMatrix4Before,
  linearPartDeterminantBefore,
  linearPartIdentityDistanceSqBefore,
  multiplyMatrix4Before,
  negateColumnMatrix4Before,
  negateRowMatrix4Before,
  transposeMatrix4Before,
} from './matrix4Before.fixture.ts'
import { linearPartIdentityDistanceSq } from './singular.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import {
  assertSameBits,
  MATRIX_KINDS,
  SENTINELS,
  sweepMatrix,
  typed,
} from '../sequence/moves.fixture.ts'

test('multiplyMatrix4: the column-wise read keeps every bit, aliased or not', () => {
  const a = new Float64Array(16),
    b = new Float64Array(16),
    old = new Float64Array(16),
    now = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    sweepMatrix(a, i, i % MATRIX_KINDS)
    sweepMatrix(b, i + HALTON_SWEEP, (i >> 2) % MATRIX_KINDS)
    assertSameBits(multiplyMatrix4Before(old, a, b), multiplyMatrix4(now, a, b), `${i}`)
    for (const alias of ['a', 'b', 'ab'] as const) {
      const oldA = a.slice(),
        oldB = alias === 'ab' ? oldA : b.slice(),
        nowA = a.slice(),
        nowB = alias === 'ab' ? nowA : b.slice()
      const oldOut = alias === 'b' ? oldB : oldA,
        nowOut = alias === 'b' ? nowB : nowA
      multiplyMatrix4Before(oldOut, oldA, oldB)
      multiplyMatrix4(nowOut, nowA, nowB)
      assertSameBits(oldOut, nowOut, `${i} out = ${alias}`)
    }
  }
})

type Unary = (out: NumberSink, m: ArrayLike<number>) => NumberSink

/** `old` and `now` on case `i`'s matrix `m`, its input and output kinds walking the nine pairs
 *  with `i`: the outputs and the returned buffer, then both in place on `m`'s kind. */
function sameUnary(old: Unary, now: Unary, m: Float64Array, i: number, label: string) {
  const inKind = i % 3,
    input = typed(inKind, m),
    oldOut = typed(((i / 3) | 0) % 3, SENTINELS),
    nowOut = typed(((i / 3) | 0) % 3, SENTINELS)
  old(oldOut, input)
  assert.equal(now(nowOut, input), nowOut, `${label}: returns out`)
  assertSameBits(oldOut, nowOut, label)
  const oldIn = typed(inKind, m),
    nowIn = typed(inKind, m)
  old(oldIn, oldIn)
  now(nowIn, nowIn)
  assertSameBits(oldIn, nowIn, `${label} in place`)
}

test('transposeMatrix4, copyMatrix4, negateColumnMatrix4, negateRowMatrix4: one pass keeps every bit', () => {
  const m = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(m, i + kind * HALTON_SWEEP, kind)
      const label = `${i} kind ${kind}`,
        index = [0, 1, 2, 3, -0][(i + kind) % 5]
      sameUnary(transposeMatrix4Before, transposeMatrix4, m, i + kind, `transpose ${label}`)
      sameUnary(copyMatrix4Before, copyMatrix4, m, i + kind, `copy ${label}`)
      sameUnary(
        (out, v) => negateColumnMatrix4Before(out, v, index),
        (out, v) => negateColumnMatrix4(out, v, index),
        m,
        i + kind,
        `column ${index} ${label}`,
      )
      sameUnary(
        (out, v) => negateRowMatrix4Before(out, v, index),
        (out, v) => negateRowMatrix4(out, v, index),
        m,
        i + kind,
        `row ${index} ${label}`,
      )
      // A copy within one buffer at overlapping offsets, either way, and between two at offsets.
      const outAt = i % 9,
        mAt = (i >> 3) % 9,
        oldBuffer = typed(kind % 3, [...m, ...m, 5, 6]),
        nowBuffer = typed(kind % 3, [...m, ...m, 5, 6])
      copyMatrix4Before(oldBuffer, oldBuffer, outAt, mAt)
      assert.equal(copyMatrix4(nowBuffer, nowBuffer, outAt, mAt), nowBuffer)
      assertSameBits(oldBuffer, nowBuffer, `copy ${label} ${mAt} → ${outAt} within`)
      const oldOut = typed(i % 3, [...SENTINELS, ...SENTINELS]),
        nowOut = typed(i % 3, [...SENTINELS, ...SENTINELS])
      copyMatrix4Before(oldOut, oldBuffer, outAt, mAt)
      copyMatrix4(nowOut, nowBuffer, outAt, mAt)
      assertSameBits(oldOut, nowOut, `copy ${label} ${mAt} → ${outAt}`)
    }
})

test('linearPartDeterminant, linearPartIdentityDistanceSq: nine reads keep every bit', () => {
  const m = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(m, i + kind * HALTON_SWEEP, kind)
      const label = `${i} kind ${kind}`
      for (let inKind = 0; inKind < 3; inKind++) {
        const input = typed(inKind, m)
        assertSameBits(
          [linearPartDeterminantBefore(input), linearPartIdentityDistanceSqBefore(input)],
          [linearPartDeterminant(input), linearPartIdentityDistanceSq(input)],
          `${label} input ${inKind}`,
        )
        // Near the identity, where the distance's terms cancel, and at an offset.
        const at = (i + inKind) % 9,
          near = typed(inKind, [...m.slice(0, at), ...m.map((v, k) => (k % 5 ? v : 1 + v * 1e-9))])
        assertSameBits(
          [linearPartIdentityDistanceSqBefore(near, at), linearPartIdentityDistanceSqBefore(near)],
          [linearPartIdentityDistanceSq(near, at), linearPartIdentityDistanceSq(near)],
          `${label} input ${inKind} near the identity at ${at}`,
        )
      }
    }
})
