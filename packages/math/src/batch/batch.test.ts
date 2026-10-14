import test from 'node:test'
import assert from 'node:assert/strict'
import { SPHERE_VALUES } from './strides.ts'
import { boxUnionBatch } from './batch.ts'
import { frustumKeepsBoxBatch, sphereFromBoundsBatch } from './culling.ts'
import {
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from './points.ts'
import { composeMatrix4 } from '../matrix/matrix4Compose.ts'
import { frustumPlanesFromMatrix } from '../geometry/frustum/frustum.ts'
import { perspectiveProjection } from '../projection/camera.ts'

test('frustumKeepsBoxBatch: culls boxes and returns kept count', () => {
  const proj = new Float64Array(16)
  perspectiveProjection(proj, 60, 1, 0.1, 1)
  const planes = new Float64Array(24)
  frustumPlanesFromMatrix(planes, proj)

  const boxes = new Float64Array([
    -1, -1, -5, 1, 1, -3, -1, -1, 5, 1, 1, 10, 100, -1, -5, 105, 1, -3,
  ])
  const out = new Uint8Array(3)
  const kept = frustumKeepsBoxBatch(out, planes, boxes, 3)
  assert.equal(kept, 1)
  assert.equal(out[0], 1)
  assert.equal(out[1], 0)
  assert.equal(out[2], 0)
})

test('transformPointsBatch and transformPointsByMatricesBatch: transforms points', () => {
  const m = new Float64Array(16)
  composeMatrix4(m, [10, 20, 30], [0, 0, 0, 1], [1, 1, 1])
  const pts = new Float64Array([1, 2, 3, 4, 5, 6])
  const out1 = new Float64Array(6)
  transformPointsBatch(out1, m, pts, 2)
  assert.equal(out1[0], 11)
  assert.equal(out1[1], 22)
  assert.equal(out1[2], 33)
  assert.equal(out1[3], 14)

  const out2 = new Float64Array(6)
  transformPointsByMatricesBatch(out2, [m, m], pts, 2)
  assert.equal(out2[0], 11)
  assert.equal(out2[3], 14)
})

test('transformDirectionsBatch: ignores translation and normalizes', () => {
  const m = new Float64Array(16)
  composeMatrix4(m, [100, 200, 300], [0, 0, 0, 1], [2, 0, 0])
  const dirs = new Float64Array([3, 0, 0])
  const out = new Float64Array(3)
  transformDirectionsBatch(out, m, dirs, 1)
  assert.ok(Math.abs(out[0] - 1) < 1e-10)
  assert.equal(out[1], 0)
  assert.equal(out[2], 0)
})

test('boxUnionBatch: bounds union', () => {
  const boxes = new Float64Array([0, 0, 0, 1, 1, 1, -2, -2, -2, 0, 0, 0])
  const into = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  boxUnionBatch(into, boxes, 2)
  assert.equal(into[0], -2)
  assert.equal(into[3], 1)
})

test('sphereFromBoundsBatch: derives sphere centre and radius', () => {
  const boxes = new Float64Array([-1, -1, -1, 1, 1, 1])
  const out = new Float64Array(SPHERE_VALUES)
  sphereFromBoundsBatch(out, boxes, 1)
  assert.equal(out[0], 0)
  assert.equal(out[1], 0)
  assert.equal(out[2], 0)
  assert.ok(Math.abs(out[3] - Math.sqrt(3)) < 1e-10)
})
