// quaternion.ts turnByAngularVelocity: one explicit step of q̇ = ½ (ω, 0) ⊗ q, made unit — the old
// per-pose body bit for bit, a quarter turn in one step, and many steps on the exact turn.
import assert from 'node:assert/strict'
import test from 'node:test'
import { axisAngleQuaternion, normalizeQuaternionAt, turnByAngularVelocity } from './quaternion.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('turnByAngularVelocity is the drawn-pose body it replaces, bit for bit, at offsets', () => {
  // A body pose: position then quaternion, seven numbers; a velocity: linear then angular, six.
  const target = new Float64Array(7),
    velocity = new Float64Array(6),
    out = new Float64Array(8),
    old = new Float64Array(8)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    for (let k = 0; k < 4; k++) target[3 + k] = haltonSpan(i, [2, 3, 5, 7][k], -1, 1)
    for (let k = 0; k < 3; k++) velocity[3 + k] = haltonSpan(i, [11, 13, 17][k], -20, 20)
    const h = haltonSpan(i, 19, 0, 0.05)
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
  // From the identity, ω = 2 about Z over the half step ½: (0, 0, 1, 1), a quarter turn made unit.
  const q = Float64Array.of(0, 0, 0, 1)
  turnByAngularVelocity(q, 0, q, 0, [0, 0, 2], 0, 0.5)
  assert.deepEqual([...q.subarray(0, 2)], [0, 0])
  assert.ok(Math.abs(q[2] - Math.SQRT1_2) <= Number.EPSILON / 2 && q[3] === q[2], String(q[2]))
})

test('turnByAngularVelocity: many small steps converge on the exact turn', () => {
  // One radian per unit time about the unit axis (2, 3, 6) / 7, over one unit in 10⁴ steps.
  const steps = 10000,
    axis = [2 / 7, 3 / 7, 6 / 7]
  const q = Float64Array.of(0, 0, 0, 1)
  for (let s = 0; s < steps; s++) turnByAngularVelocity(q, 0, q, 0, axis, 0, 0.5 / steps)
  const exact = axisAngleQuaternion(new Float64Array(4), axis, 1)
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(q[k] - exact[k]) <= 1e-4, `${k}: ${q[k]}`)
})
