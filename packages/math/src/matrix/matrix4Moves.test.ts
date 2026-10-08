// `multiplyMatrix4` reads `b` one column at a time: on every matrix kind of the sweep, hostile
// entries included, and with `out` as `a`, as `b` or as both, its sixteen values keep their bits.
import test from 'node:test'
import { multiplyMatrix4 } from './matrix4.ts'
import { multiplyMatrix4Before } from './matrix4Before.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, MATRIX_KINDS, sweepMatrix } from '../sequence/moves.fixture.ts'

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
