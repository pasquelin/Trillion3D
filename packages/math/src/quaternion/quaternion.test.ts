import assert from 'node:assert/strict'
import test from 'node:test'
import {
  multiplyQuaternionVectorFirst,
  conjugateQuaternion,
  dotQuaternion,
  lengthQuaternion,
  normalizeQuaternion,
  quaternionAngle,
  slerpArc,
} from './quaternion.ts'
import { hypot4 } from '../float/hypot.ts'

const scaledBy = (q: number[], length: number) => q.map((v) => v / length)

test('a quaternion of ordinary size is divided by the root of its Kahan-summed squares', () => {
  // 1² + 2² + 3² + 4² = 30 exactly: the unscaled length is √30 rounded once.
  assert.deepEqual(
    Array.from(normalizeQuaternion(Float64Array.from([1, 2, 3, 4]))),
    scaledBy([1, 2, 3, 4], Math.sqrt(30)),
  )
  // Four equal tenths: the unit quaternion of halves, exactly.
  assert.deepEqual(
    Array.from(normalizeQuaternion(Float64Array.from([0.1, 0.1, 0.1, 0.1]))),
    [0.5, 0.5, 0.5, 0.5],
  )
})

test('zero, a NaN, an infinity and magnitudes near the limits keep the scaled length', () => {
  const cases = [
    [0, 0, 0, 0],
    [-0, 0, -0, 0],
    [NaN, 1, 0, 0],
    [Infinity, 1, 0, 0],
    [1e300, 1e300, 0, 0],
    [1e-200, 2e-200, 0, 3e-200],
    [2 ** -1074, 0, 0, 0],
  ]
  for (const q of cases) {
    const out = Array.from(normalizeQuaternion(Float64Array.from(q)))
    assert.deepEqual(out, scaledBy(q, hypot4(q[0], q[1], q[2], q[3]) || 1), String(q))
  }
})

test('dotQuaternion sums the four products at their offsets; lengthQuaternion is its root', () => {
  assert.equal(dotQuaternion([1, 2, 3, 4], [5, 6, 7, 8]), 70)
  assert.equal(dotQuaternion([0, 1, 2, 3, 4], [0, 0, 5, 6, 7, 8], 1, 2), 70)
  assert.equal(lengthQuaternion([1, 2, 3, 4]), Math.sqrt(30))
  assert.equal(lengthQuaternion([0, 0.5, 0.5, 0.5, 0.5], 1), 1)
})

test('slerpArc reads the cosine of the arc as dotQuaternion sums it', () => {
  const a = [0.1, -0.7, 0.3, 0.6],
    b = [-0.2, 0.5, -0.4, -0.7]
  const arc = slerpArc(new Float64Array(3), 0, a, 0, b, 0)
  // The dot is negative: the shorter way goes to −b, and the angle is that of |a · b|.
  assert.equal(arc[0], -1)
  assert.ok(Math.abs(arc[1] - Math.acos(-dotQuaternion(a, b))) < 1e-15)
})

test('conjugateQuaternion negates the axis part, signed zeros kept, in place allowed', () => {
  const out = conjugateQuaternion(new Float64Array(4), [1, -2, 0, 4])
  assert.deepEqual([...out], [-1, 2, -0, 4])
  assert.ok(Object.is(out[2], -0))
  const q = Float64Array.of(9, 1, -2, 3, 4)
  conjugateQuaternion(q, q, 1, 1)
  assert.deepEqual([...q], [9, -1, 2, -3, 4])
})

test('quaternionAngle: a quarter turn apart is π/2, q against −q is 0', () => {
  const half = Math.PI / 4
  const turn = [0, 0, Math.sin(half), Math.cos(half)]
  assert.ok(Math.abs(quaternionAngle([0, 0, 0, 1], turn) - Math.PI / 2) <= 1e-15)
  assert.equal(
    quaternionAngle(
      turn,
      turn.map((v) => -v),
    ),
    0,
  )
})

test('the vector-first product is the Hamilton product, aliasing allowed', () => {
  const a = Float64Array.of(1, 2, 3, 4)
  assert.deepEqual(
    [...multiplyQuaternionVectorFirst(new Float64Array(4), a, [5, 6, 7, 8])],
    [24, 48, 48, -6],
  )
  assert.deepEqual([...multiplyQuaternionVectorFirst(a, a, [5, 6, 7, 8])], [24, 48, 48, -6])
})
