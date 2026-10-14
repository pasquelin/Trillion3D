import assert from 'node:assert/strict'
import test from 'node:test'
import { rayRectangle, raySphere } from './rayShapes.ts'

test('raySphere: both crossings, nearer first, for a direction of any length; a miss writes nothing', () => {
  const span = new Float64Array([7, 7])
  assert.equal(raySphere(span, [0, 0, -5], [0, 0, 2], [0, 0, 0], 1), true)
  assert.deepEqual([...span], [2, 3])
  assert.equal(raySphere(span, [0, 2, -5], [0, 0, 1], [0, 0, 0], 1), false)
  assert.equal(raySphere(span, [0, 0, -5], [0, 0, 0], [0, 0, 0], 1), false)
  assert.deepEqual([...span], [2, 3])
})

test('rayRectangle: the crossing within the half-sides, either sign; NaN outside or along the plane', () => {
  const at = [0, 0, 0],
    n = [0, 1, 0],
    u = [1, 0, 0],
    v = [0, 0, 1]
  assert.equal(rayRectangle([0.5, 2, -1], [0, -1, 0], at, n, u, v, 1, 2), 2)
  assert.equal(rayRectangle([0.5, 2, -1], [0, 1, 0], at, n, u, v, 1, 2), -2)
  assert.ok(Number.isNaN(rayRectangle([1.5, 2, 0], [0, -1, 0], at, n, u, v, 1, 2)))
  assert.ok(Number.isNaN(rayRectangle([0, 2, 0], [1, 0, 0], at, n, u, v, 1, 2)))
})
