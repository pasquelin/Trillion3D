// The vector rewrites against their before-forms (`vectorBefore.fixture.ts`): `writeCrossVector3`
// and `writeNormalizedVector3`, the one homes of the cross product and of the normalisation, keep
// every bit of the bodies that held them — on swept and hostile values, vectors short enough for
// the 2^1000 branch, zero vectors, every sink the signatures accept, offsets and aliasing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { crossVector3, length3, normalizeVector3, transformDirectionVector3 } from './vector.ts'
import {
  crossVector3Before,
  normalizeVector3Before,
  transformDirectionVector3Before,
} from './vectorBefore.fixture.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, MATRIX_KINDS, sweepInput, sweepMatrix } from '../sequence/moves.fixture.ts'

type Sink = Float64Array | Float32Array | Int32Array | number[]

/** The sinks a `NumberSink` takes, each filled from `values`: doubles, floats, integers, plain. */
const SINKS: ((values: ArrayLike<number>) => Sink)[] = [
  (values) => Float64Array.from(values),
  (values) => Float32Array.from(values),
  (values) => Int32Array.from(values),
  (values) => Array.from(values),
]

/** The scales a swept vector is laid at: as drawn, below 2^-1024 (the 2^1000 branch, subnormal
 *  components), and at the last subnormals, where most components round to zero. */
const SCALES = [1, 2 ** -1050, 2 ** -1072]

/** Case `i`'s `count` swept values from slot `at` on `[−50, 50)`, hostile values mixed in, times
 *  `scale`; one case in eleven is all zeros of mixed signs. */
const swept = (i: number, at: number, count: number, scale = 1) =>
  Float64Array.from({ length: count }, (_, k) =>
    i % 11 === 0 ? (k & 1 ? -0 : 0) : sweepInput(i, at + k, 2, -50, 50) * scale,
  )

/** Whether `(x, y, z)` takes the 2^1000 branch: non-zero, its inverse length overflowing. */
const tiny = (x: number, y: number, z: number) => 1 / (length3(x, y, z) || 1) === Infinity

test('crossVector3: writeCrossVector3 keeps every bit, offsets and out as either operand', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = swept(i, 0, 6),
      b = swept(i + 1, 6, 6)
    for (const make of SINKS) {
      const [outAt, aAt, bAt] = [i % 3, (i >> 1) % 4, (i >> 3) % 4]
      const old = make(new Float64Array(6).fill(7)),
        now = make(new Float64Array(6).fill(7))
      assert.equal(crossVector3Before(old, a, b, outAt, aAt, bAt), old)
      assert.equal(crossVector3(now, a, b, outAt, aAt, bAt), now)
      assertSameBits(old, now, `cross ${i}`)
    }
    for (const make of [SINKS[0], SINKS[3]]) {
      const oldA = make(a),
        nowA = make(a),
        oldB = make(b),
        nowB = make(b)
      crossVector3Before(oldA, oldA, b, i % 4, (i >> 2) % 4, 1)
      crossVector3(nowA, nowA, b, i % 4, (i >> 2) % 4, 1)
      assertSameBits(oldA, nowA, `cross out = a ${i}`)
      crossVector3Before(oldB, a, oldB, (i >> 2) % 4, 2, i % 4)
      crossVector3(nowB, a, nowB, (i >> 2) % 4, 2, i % 4)
      assertSameBits(oldB, nowB, `cross out = b ${i}`)
    }
  }
})

test('normalizeVector3: writeNormalizedVector3 keeps every bit, the 2^1000 branch included', () => {
  let branch = 0
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (const scale of SCALES) {
      const v = swept(i, 0, 6, scale)
      for (const at of [0, 1, 3]) {
        if (tiny(v[at], v[at + 1], v[at + 2])) branch++
        for (const make of SINKS) {
          const old = make(v),
            now = make(v)
          normalizeVector3Before(old, at)
          normalizeVector3(now, at)
          assertSameBits(old, now, `normalize ${i} scale ${scale} at ${at}`)
        }
      }
    }
  assert.ok(branch > HALTON_SWEEP, `the 2^1000 branch ran ${branch} times`)
})

test('transformDirectionVector3: the product in locals on a double sink, every other sink as before', () => {
  const m = new Float64Array(16)
  let branch = 0
  for (let i = 1; i <= HALTON_SWEEP / 4; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(m, i, kind)
      const scale = SCALES[(i + kind) % SCALES.length]
      const [x, y, z] = swept(i, 20, 3, scale)
      if (
        tiny(
          m[0] * x + m[4] * y + m[8] * z,
          m[1] * x + m[5] * y + m[9] * z,
          m[2] * x + m[6] * y + m[10] * z,
        )
      )
        branch++
      for (const make of SINKS)
        for (const o of [0, 2]) {
          const old = make(new Float64Array(6).fill(7)),
            now = make(new Float64Array(6).fill(7))
          assert.equal(transformDirectionVector3Before(old, m, x, y, z, o), old)
          assert.equal(transformDirectionVector3(now, m, x, y, z, o), now)
          assertSameBits(old, now, `direction ${i} kind ${kind} o ${o}`)
        }
      // `out` as the matrix itself, at every offset: the rows of `m` read after a write see it.
      for (const make of [SINKS[0], SINKS[3]])
        for (let o = 0; o < 14; o++) {
          const old = make(m),
            now = make(m)
          transformDirectionVector3Before(old, old, x, y, z, o)
          transformDirectionVector3(now, now, x, y, z, o)
          assertSameBits(old, now, `direction out = m ${i} kind ${kind} o ${o}`)
        }
      // `out` a view over the matrix's own memory, further on.
      for (const shift of [1, 4, 9]) {
        const old = new Float64Array(20),
          now = new Float64Array(20)
        old.set(m)
        now.set(m)
        transformDirectionVector3Before(old.subarray(shift), old, x, y, z, i % 3)
        transformDirectionVector3(now.subarray(shift), now, x, y, z, i % 3)
        assertSameBits(old, now, `direction over m ${i} kind ${kind} shift ${shift}`)
      }
    }
  assert.ok(branch > 1000, `the 2^1000 branch ran ${branch} times`)
})
