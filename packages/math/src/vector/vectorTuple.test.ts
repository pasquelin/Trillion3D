import test from 'node:test'
import assert from 'node:assert/strict'
import { cross, subtract, unit } from './vectorTuple.ts'

test('tuple products preserve inputs and allocate a distinct result on each call', () => {
  const a: [number, number, number] = [1, 2, 3]
  const b: [number, number, number] = [4, 5, 6]
  const product = cross(a, b)
  assert.deepEqual(product, [-3, 6, -3])
  assert.notEqual(product, cross(a, b))
  const difference = subtract(new Float64Array(a), { 0: 4, 1: 5, 2: 6, length: 3 })
  assert.deepEqual(difference, [-3, -3, -3])
  assert.notEqual(difference, subtract(a, b))
  assert.deepEqual(a, [1, 2, 3])
  assert.deepEqual(b, [4, 5, 6])
  assert.deepEqual(subtract([-0, Infinity, NaN], [0, Infinity, 0]), [-0, NaN, NaN])
})

test('normalization returns the same tuple and preserves zero and non-finite behavior', () => {
  const input: [number, number, number] = [3, 0, 4]
  assert.equal(unit(input), input)
  assert.deepEqual(input, [3 * (1 / 5), 0, 4 * (1 / 5)])
  assert.deepEqual(unit([-0, 0, 0]), [-0, 0, 0])
  assert.deepEqual(unit([Infinity, 1, -1]), [NaN, 0, -0])
  assert.deepEqual(unit([NaN, 1, -1]), [NaN, 1, -1])
})
