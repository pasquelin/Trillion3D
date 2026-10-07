// forwardZ.ts: the projections of a view down +z in reversed depth — near to 1, far to 0 — against
// their depths, a round trip from depth back to z, and the shadow builders they replace bit for bit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { forwardOrthographicProjection, forwardPerspectiveProjection } from './forwardZ.ts'
import { focalScale } from './camera.ts'
import { HALTON_SWEEP, haltonSpan } from '../sequence/sweep.fixture.ts'

const depthOf = (p: ArrayLike<number>, z: number) => (p[10] * z + p[14]) / (p[11] * z + p[15])

test('forwardPerspectiveProjection: near → 1, far → 0, and depth reads back its z', () => {
  const p = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const near = haltonSpan(i, 2, 0.01, 50),
      far = near + haltonSpan(i, 3, 0.01, 1e4)
    forwardPerspectiveProjection(p, 2, near, far)
    assert.ok(Math.abs(depthOf(p, near) - 1) <= 1e-12, `near ${i}`)
    assert.ok(Math.abs(depthOf(p, far)) <= 1e-12, `far ${i}`)
    // A depth d is (p10·z + p14) / z, so z = p14 / (d − p10).
    const z = haltonSpan(i, 5, near, far),
      back = p[14] / (depthOf(p, z) - p[10])
    assert.ok(Math.abs(back - z) <= 1e-9 * z, `round trip ${i}: ${back} vs ${z}`)
  }
  assert.deepEqual([p[0], p[5], p[11], p[15]], [2, 2, 1, 0])
  forwardPerspectiveProjection(p, 1, 3, 3)
  assert.deepEqual([p[10], p[14]], [0, 3])
  assert.equal(depthOf(p, 3), 1)
})

test('forwardPerspectiveProjection is the spot and cube-face builders, bit for bit', () => {
  const p = new Float64Array(16),
    old = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const minZ = haltonSpan(i, 2, 0, 40),
      maxZ = minZ + haltonSpan(i, 3, 1e-6, 400),
      halfFov = haltonSpan(i, 5, 0.01, 1.5)
    // The spot's caster range: unit scale.
    old.fill(0)
    old[0] = 1
    old[5] = 1
    old[10] = -minZ / (maxZ - minZ)
    old[11] = 1
    old[14] = (maxZ * minZ) / (maxZ - minZ)
    forwardPerspectiveProjection(p, 1, minZ, maxZ)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(p[k], old[k]), `spot ${i}.${k}`)
    // A face of a point light: the cotangent of its half field.
    old.fill(0)
    const t = Math.tan(halfFov)
    old[0] = old[5] = 1 / t
    old[10] = minZ / (minZ - maxZ)
    old[11] = 1
    old[14] = (-maxZ * minZ) / (minZ - maxZ)
    forwardPerspectiveProjection(p, focalScale(halfFov), minZ, maxZ)
    for (let k = 0; k < 16; k++) assert.ok(Object.is(p[k], old[k]), `face ${i}.${k}`)
  }
})

test('forwardOrthographicProjection: the box edges to ±1, its depth span from 1 to 0', () => {
  const p = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const hw = haltonSpan(i, 2, 0.5, 500),
      hh = haltonSpan(i, 3, 0.5, 500),
      depthScale = 1 / haltonSpan(i, 5, 1, 1e4),
      depthOffset = haltonSpan(i, 7, -100, 100)
    forwardOrthographicProjection(p, hw, hh, depthScale, depthOffset)
    assert.ok(Math.abs(p[0] * hw - 1) <= 2 ** -52 && Math.abs(p[5] * hh - 1) <= 2 ** -52, `${i}`)
    assert.ok(Math.abs(depthOf(p, -depthOffset) - 1) <= 1e-12, `near ${i}`)
    const far = 1 / depthScale - depthOffset
    assert.ok(Math.abs(depthOf(p, far)) <= 1e-9, `far ${i}: ${depthOf(p, far)}`)
    // Back from depth: z = (p14 − d) / depthScale.
    const z = haltonSpan(i, 11, -depthOffset, far)
    assert.ok(Math.abs((p[14] - depthOf(p, z)) / depthScale - z) <= 1e-9 * (1 + Math.abs(z)))
    // The clipmap builder it replaces.
    const old = new Float64Array(16)
    old[0] = 1 / hw
    old[5] = 1 / hh
    old[10] = -depthScale
    old[14] = 1 - depthOffset * depthScale
    old[15] = 1
    for (let k = 0; k < 16; k++) assert.ok(Object.is(p[k], old[k]), `old ${i}.${k}`)
  }
  forwardOrthographicProjection(p, 0, 0, 1, 0)
  assert.deepEqual([p[0], p[5]], [1, 1])
})
