import assert from 'node:assert/strict'
import test from 'node:test'
import { lightAffectsSphere } from './affects.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'

const point = (z: number, radius: number): VsmProjectionLight => ({
  type: 'point',
  mapId: 0,
  direction: [0, 0, -1],
  position: [0, 0, z],
  radius,
})
const spot = (angle: number): VsmProjectionLight => ({
  type: 'spot',
  mapId: 0,
  direction: [0, 0, -1],
  position: [0, 0, 10],
  radius: 100,
  coneAngle: angle,
})

test('a sun reaches the bounds, a point light only within its range and the bounds radius', () => {
  assert.ok(
    lightAffectsSphere({ type: 'directional', mapId: 0, direction: [0, 0, -1] }, [5, 5, 5], 1),
  )
  assert.ok(lightAffectsSphere(point(10, 5), [0, 0, 5], 1))
  assert.ok(!lightAffectsSphere(point(10, 3), [0, 0, 5], 1))
})

test('a spot reaches the bounds in front of it and not the bounds behind or beside its cone', () => {
  assert.ok(lightAffectsSphere(spot(0.5), [0, 0, 0], 1))
  assert.ok(!lightAffectsSphere(spot(0.5), [0, 0, 20], 1))
  assert.ok(!lightAffectsSphere(spot(0.1), [30, 0, 9], 1))
})
