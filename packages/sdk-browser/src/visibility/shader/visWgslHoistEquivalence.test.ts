import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hoisted,
  perVertex,
  IDENTITY,
  MIRROR_X,
  NEAR_SINGULAR,
  LARGE_SCALE,
  type Mat4,
  type Point,
} from '../../../../../bench/oracles/browser/mat4HoistOracle.ts'

// The three vertices projected with the product named once are those a product redone for each
// would have given, on hostile matrices.

function assertSameTriangle(viewProj: Mat4, world: Mat4, vertices: readonly Point[]) {
  const a = hoisted(viewProj, world, vertices)
  const b = perVertex(viewProj, world, vertices)
  assert.deepEqual(a, b)
}

const TRIANGLE: readonly Point[] = [
  [0.1, -0.2, 0.3],
  [1, 1, 0.5],
  [-2, 0.4, 0.9],
]

test('identical projected vertices, identity matrix', () => {
  assertSameTriangle(IDENTITY, IDENTITY, TRIANGLE)
})

test('identical projected vertices, mirror matrix (imported negative scale)', () => {
  assertSameTriangle(IDENTITY, MIRROR_X, TRIANGLE)
  assertSameTriangle(MIRROR_X, MIRROR_X, TRIANGLE)
})

test('identical projected vertices, near-singular matrix', () => {
  assertSameTriangle(IDENTITY, NEAR_SINGULAR, TRIANGLE)
})

test('identical projected vertices, large scale (world imported in millimetres)', () => {
  assertSameTriangle(LARGE_SCALE, IDENTITY, TRIANGLE)
  assertSameTriangle(LARGE_SCALE, MIRROR_X, TRIANGLE)
})
