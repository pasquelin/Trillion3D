// quaternion.ts turnByAngularVelocity: the exact turn of a constant ω, `(ω̂ sin θ, cos θ) ⊗ q` —
// a quarter turn in one step, many steps the one, the axis-angle turn itself —, and under its small
// angle the explicit step of `q̇ = ½ (ω, 0) ⊗ q` bit for bit. arcAngularVelocity: the rate an arc
// turns at, which the turn goes on along exactly as `slerpOnArc` does past the arc's end.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  arcAngularVelocity,
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternionAt,
  slerpArc,
  slerpOnArc,
  turnByAngularVelocity,
} from './quaternion.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

/** A unit quaternion of the sweep's sample `i`, from the bases `p`. */
function unit(i: number, p: number[]) {
  const q = new Float64Array(4)
  for (let k = 0; k < 4; k++) q[k] = haltonSpan(i, p[k], -1, 1)
  return normalizeQuaternionAt(q, 0, q[0], q[1], q[2], q[3])
}

test('under the small half-angle the turn is the explicit step, bit for bit, at offsets', () => {
  // A body pose: position then quaternion, seven numbers; a velocity: linear then angular, six.
  const target = new Float64Array(7),
    velocity = new Float64Array(6),
    out = new Float64Array(8),
    old = new Float64Array(8)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    target.set(unit(i, [2, 3, 5, 7]), 3)
    for (let k = 0; k < 3; k++) velocity[3 + k] = haltonSpan(i, [11, 13, 17][k], -20, 20)
    // |ω| · h under 2⁻²⁷: |ω| < 35, h < 2⁻³³.
    const h = haltonSpan(i, 19, 0, 2 ** -33)
    const wx = velocity[3],
      wy = velocity[4],
      wz = velocity[5],
      tx = target[3],
      ty = target[4],
      tz = target[5],
      tw = target[6]
    normalizeQuaternionAt(
      old,
      4,
      tx + h * (wx * tw + wy * tz - wz * ty),
      ty + h * (wy * tw + wz * tx - wx * tz),
      tz + h * (wz * tw + wx * ty - wy * tx),
      tw - h * (wx * tx + wy * ty + wz * tz),
    )
    turnByAngularVelocity(out, 4, target, 3, velocity, 3, h)
    for (let k = 4; k < 8; k++) assert.ok(Object.is(out[k], old[k]), `${i}.${k}`)
  }
})

test('turnByAngularVelocity: a quarter turn in one step, in place', () => {
  // From the identity, ω = π about Z over the time ½ (half of it ¼): a quarter turn.
  const q = Float64Array.of(0, 0, 0, 1)
  turnByAngularVelocity(q, 0, q, 0, [0, 0, Math.PI], 0, 0.25)
  assert.deepEqual([...q.subarray(0, 2)], [0, 0])
  assert.ok(Math.abs(q[2] - Math.SQRT1_2) <= Number.EPSILON, String(q[2]))
  assert.ok(Math.abs(q[3] - Math.SQRT1_2) <= Number.EPSILON, String(q[3]))
})

test('turnByAngularVelocity is the axis-angle turn, and many steps are the one', () => {
  const axis = new Float64Array(3),
    w = new Float64Array(3),
    turn = new Float64Array(4),
    exact = new Float64Array(4),
    one = new Float64Array(4),
    many = new Float64Array(4)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const q = unit(i, [2, 3, 5, 7])
    for (let k = 0; k < 3; k++) axis[k] = haltonSpan(i, [11, 13, 17][k], -1, 1)
    const length = Math.sqrt(axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2)
    for (let k = 0; k < 3; k++) axis[k] /= length
    const rate = haltonSpan(i, 19, 0, 200),
      time = haltonSpan(i, 23, 0, 0.05)
    for (let k = 0; k < 3; k++) w[k] = axis[k] * rate
    multiplyQuaternion(exact, axisAngleQuaternion(turn, axis, rate * time), q)
    turnByAngularVelocity(one, 0, q, 0, w, 0, time / 2)
    many.set(q)
    for (let s = 0; s < 16; s++) turnByAngularVelocity(many, 0, many, 0, w, 0, time / 32)
    for (let k = 0; k < 4; k++) {
      assert.ok(Math.abs(one[k] - exact[k]) <= 1e-14, `${i}.${k}: ${one[k]} ${exact[k]}`)
      assert.ok(Math.abs(many[k] - one[k]) <= 1e-13, `${i}.${k}: ${many[k]} ${one[k]}`)
    }
  }
})

test('the turn at the arc rate goes on along the arc as slerpOnArc does past its end', () => {
  const arc = new Float64Array(3),
    w = new Float64Array(3),
    along = new Float64Array(4),
    turned = new Float64Array(4)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const a = unit(i, [2, 3, 5, 7]),
      b = unit(i, [11, 13, 17, 19])
    slerpArc(arc, 0, a, 0, b, 0)
    const step = haltonSpan(i, 23, 0.001, 0.05),
      t = haltonSpan(i, 29, 1, 3)
    arcAngularVelocity(w, 0, a, 0, b, 0, arc, 0, step)
    slerpOnArc(along, 0, a, 0, b, 0, t, arc, 0)
    normalizeQuaternionAt(along, 0, along[0], along[1], along[2], along[3])
    turnByAngularVelocity(turned, 0, b, 0, w, 0, ((t - 1) * step) / 2)
    // The same rotation: the quaternion, or its opposite.
    const sign =
      along[0] * turned[0] + along[1] * turned[1] + along[2] * turned[2] + along[3] * turned[3] < 0
        ? -1
        : 1
    for (let k = 0; k < 4; k++)
      assert.ok(
        Math.abs(sign * turned[k] - along[k]) <= 1e-12,
        `${i}.${k}: ${turned[k]} ${along[k]}`,
      )
  }
})
