// spherical.ts and quaternion.ts: a direction's yaw and pitch, and the orientation they turn −Z
// into — the two inverse of each other, the orientation the product of its two axis turns.
import assert from 'node:assert/strict'
import test from 'node:test'
import { directionYawPitch } from './spherical.ts'
import {
  axisAngleQuaternion,
  multiplyQuaternion,
  rotateByQuaternion,
  yawPitchQuaternion,
} from '../quaternion/quaternion.ts'
import { HALF_PI } from '../constants.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

test('directionYawPitch: the axes and a diagonal, whatever the direction length', () => {
  const out = new Float64Array(2)
  directionYawPitch(out, 0, 0, -3)
  assert.ok(out[0] === 0 && out[1] === 0)
  assert.deepEqual([...directionYawPitch(out, -2, 0, 0)], [HALF_PI, 0])
  // At a pole the yaw is any; the pitch is the quarter turn exactly.
  assert.equal(directionYawPitch(out, 0, 5, 0)[1], HALF_PI)
  assert.equal(directionYawPitch(out, 0, -5, 0)[1], -HALF_PI)
  // (1, √2, 1): horizontal length √2, so a pitch of π/4, yaw towards +X from −Z behind: −3π/4.
  directionYawPitch(out, 1, Math.SQRT2, 1)
  assert.ok(
    Math.abs(out[0] + (3 * Math.PI) / 4) <= 1e-15 && Math.abs(out[1] - Math.PI / 4) <= 1e-15,
  )
})

test('yawPitchQuaternion is the yaw turn times the pitch turn, and the old orbit body bit for bit', () => {
  const q = new Float64Array(4),
    yawTurn = new Float64Array(4),
    pitchTurn = new Float64Array(4),
    product = new Float64Array(4)
  // The orbit orientation it replaces: the azimuth and the polar angle less a quarter turn.
  const orbit = (theta: number, phi: number) => {
    const halfAzimuth = theta / 2,
      halfPolar = (phi - HALF_PI) / 2
    const sy = Math.sin(halfAzimuth),
      cy = Math.cos(halfAzimuth),
      sx = Math.sin(halfPolar),
      cx = Math.cos(halfPolar)
    return [cy * sx, sy * cx, -sy * sx, cy * cx]
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const yaw = haltonSpan(i, 2, -2 * Math.PI, 2 * Math.PI),
      phi = haltonSpan(i, 3, 1e-6, Math.PI - 1e-6)
    yawPitchQuaternion(q, yaw, phi - HALF_PI)
    const old = orbit(yaw, phi)
    for (let k = 0; k < 4; k++) assert.ok(Object.is(q[k], old[k]), `orbit ${i}.${k}`)
    axisAngleQuaternion(yawTurn, [0, 1, 0], yaw)
    axisAngleQuaternion(pitchTurn, [1, 0, 0], phi - HALF_PI)
    multiplyQuaternion(product, yawTurn, pitchTurn)
    // Equal up to the sign of a zero: the product only adds zero terms.
    for (let k = 0; k < 4; k++) assert.ok(q[k] === product[k], `product ${i}.${k}`)
  }
  assert.deepEqual([...yawPitchQuaternion(q, 0, 0)], [0, 0, -0, 1])
})

test('directionYawPitch reads back the yaw and pitch yawPitchQuaternion turns −Z by', () => {
  const q = new Float64Array(4),
    forward = new Float64Array(3),
    angles = new Float64Array(2)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const yaw = haltonSpan(i, 2, -Math.PI + 1e-9, Math.PI),
      pitch = haltonSpan(i, 3, -HALF_PI + 1e-6, HALF_PI - 1e-6)
    rotateByQuaternion(forward, yawPitchQuaternion(q, yaw, pitch), 0, 0, -1)
    directionYawPitch(angles, forward[0], forward[1], forward[2])
    assert.ok(Math.abs(angles[0] - yaw) <= 1e-9, `yaw ${i}: ${angles[0]} vs ${yaw}`)
    assert.ok(Math.abs(angles[1] - pitch) <= 1e-12, `pitch ${i}: ${angles[1]} vs ${pitch}`)
  }
})
