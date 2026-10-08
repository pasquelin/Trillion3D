// `multiplyMatrix4Typed`'s direct path for three `Float64Array`s against its before-form, which
// always copied (`matrix4Before.fixture.ts`): on every matrix kind, for every mix of `Float64Array`,
// `Float32Array` and plain array, with `out` as `a`, as `b` or as both, `a` as `b`, and with views
// of one buffer overlapping at every shift on either side of `a` and `b`, every value keeps its
// bits and nothing past the sixteen is written.
import assert from 'node:assert/strict'
import test from 'node:test'
import { multiplyMatrix4TypedBefore } from './matrix4Before.fixture.ts'
import { multiplyMatrix4Typed } from './matrix4Typed.ts'
import { SENTINELS, typed } from './buffers.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, MATRIX_KINDS, sweepMatrix } from '../sequence/moves.fixture.ts'

type Aliasing = 'none' | 'out = a' | 'out = b' | 'a = b' | 'out = a = b'
const ALIASINGS: Aliasing[] = ['none', 'out = a', 'out = b', 'a = b', 'out = a = b']

/** The three operands of one run, of kinds `kinds`, sharing as `alias` says: fresh each call, so
 *  the before-form and the shipped one each get their own. */
function operands(alias: Aliasing, kinds: number[], a: Float64Array, b: Float64Array) {
  const left = typed(kinds[0], a),
    right = alias === 'a = b' || alias === 'out = a = b' ? left : typed(kinds[1], b)
  const out =
    alias === 'out = a' || alias === 'out = a = b'
      ? left
      : alias === 'out = b'
        ? right
        : typed(kinds[2], SENTINELS)
  return [out, left, right] as const
}

test('multiplyMatrix4Typed: the direct path keeps every bit, aliased or not', () => {
  const a = new Float64Array(16),
    b = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(a, i + kind * HALTON_SWEEP, kind)
      sweepMatrix(b, i + 3 * HALTON_SWEEP, (i + kind) % MATRIX_KINDS)
      // The 27 kind triples walk with `i`, all-`Float64Array` (the direct path) two cases in three.
      const j = (i / 3) | 0,
        kinds = i % 3 ? [0, 0, 0] : [j % 3, ((j / 3) | 0) % 3, ((j / 9) | 0) % 3]
      for (const alias of ALIASINGS) {
        const [oldOut, oldA, oldB] = operands(alias, kinds, a, b),
          [nowOut, nowA, nowB] = operands(alias, kinds, a, b)
        multiplyMatrix4TypedBefore(oldOut, oldA, oldB)
        assert.equal(multiplyMatrix4Typed(nowOut, nowA, nowB), nowOut, `${i} returns out`)
        const label = `${i} kind ${kind} ${kinds} ${alias}`
        assertSameBits(oldOut, nowOut, label)
        assertSameBits(oldA, nowA, `${label}: a`)
        assertSameBits(oldB, nowB, `${label}: b`)
      }
    }
})

test('multiplyMatrix4Typed: views of one buffer, overlapping at every shift, keep every bit', () => {
  const a = new Float64Array(16),
    b = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    sweepMatrix(a, i, i % MATRIX_KINDS)
    sweepMatrix(b, i + HALTON_SWEEP, (i >> 2) % MATRIX_KINDS)
    // `out` 1 to 15 floats after or before `b` (the copies), or `a` (the direct path for three
    // `Float64Array`s); the other operand in a buffer of its own.
    const shift = 1 + (i % 15),
      onB = (i & 16) === 0,
      after = (i & 32) === 0,
      shared = after ? 0 : shift,
      outAt = after ? shared + shift : shared - shift
    for (const Buffer of [Float64Array, Float32Array]) {
      const views = () => {
        const buffer = new Buffer(34).fill(7),
          apart = new Buffer(18).fill(7)
        buffer.set(onB ? b : a, shared)
        apart.set(onB ? a : b)
        const at = (start: number) => buffer.subarray(start, start + 16),
          other = apart.subarray(0, 16)
        return [
          [buffer, apart],
          at(outAt),
          onB ? other : at(shared),
          onB ? at(shared) : other,
        ] as const
      }
      const [oldBuffers, oldOut, oldA, oldB] = views(),
        [nowBuffers, nowOut, nowA, nowB] = views()
      multiplyMatrix4TypedBefore(oldOut, oldA, oldB)
      multiplyMatrix4Typed(nowOut, nowA, nowB)
      const label = `${i} ${Buffer.name} out ${outAt} on ${onB ? 'b' : 'a'} at ${shared}`
      assertSameBits(oldBuffers[0], nowBuffers[0], label)
      assertSameBits(oldBuffers[1], nowBuffers[1], `${label}: the other operand`)
    }
  }
})
