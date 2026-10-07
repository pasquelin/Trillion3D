import assert from 'node:assert/strict'
import { test } from 'node:test'
import { length3Float32 } from './lengthFloat32.ts'

test('length3Float32 is exact on Pythagorean quadruples and keeps +0', () => {
  assert.equal(length3Float32(3, 4, 12), 13)
  assert.equal(length3Float32(-1, 2, -2), 3)
  assert.ok(Object.is(length3Float32(-0, 0, -0), 0))
  assert.ok(Number.isNaN(length3Float32(NaN, 0, 0)))
})

test('length3Float32 rounds each step in a float32 cell, as the GPU does', () => {
  // The reference computes in a Float32Array, each store one rounding.
  const cell = new Float32Array(4)
  for (const [x, y, z] of [
    [1 + 2 ** -23, 1 - 2 ** -24, 0.1],
    [0.3, 0.7, 0.648074069840786],
    [1e-20, 1e-20, 1e-20],
    [1e19, 3e19, 2e19],
  ]) {
    cell.set([x, y, z])
    const [fx, fy, fz] = cell
    cell[3] = fx * fx
    cell[0] = fy * fy
    cell[3] = cell[3] + cell[0]
    cell[0] = fz * fz
    cell[3] = cell[3] + cell[0]
    cell[3] = Math.sqrt(cell[3])
    assert.ok(Object.is(length3Float32(fx, fy, fz), cell[3]), `${x}, ${y}, ${z}`)
  }
  assert.equal(length3Float32(1e-23, 0, 0), 0, 'a square below the float32 range flushes to 0')
})
