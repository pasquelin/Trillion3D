import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { DEFORM_WGSL } from './deformWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

test('GPU skin blending normalizes source weights without changing their stored bytes', () => {
  const weights = new Float32Array([0.2, 0.3])
  const before = weights.slice()
  const { deformSkin } = shaderRun<{
    deformSkin: (
      header: { influences: number },
      page: object,
      vertex: number,
      at: number,
      count: number,
      point: number[],
    ) => number[]
  }>(wgslModule(DEFORM_WGSL), ['deformSkin'], {
    deformWeight: (_h: unknown, _p: unknown, _v: number, k: number) => weights[k],
    deformJointId: (_h: unknown, _p: unknown, _v: number, k: number) => k,
    // Scalar multiplication is the identity palette's action on this vector.
    deformJoint: () => 1,
  })
  const point = [2, 3, 4, 1]
  assert.deepEqual(deformSkin({ influences: 2 }, {}, 0, 0, 2, point), point.slice(0, 3))
  assert.deepEqual(weights, before)
  weights.fill(0)
  assert.deepEqual(deformSkin({ influences: 2 }, {}, 0, 0, 2, point), point.slice(0, 3))
})

test('a tangent is turned across the normal a deformation leaves, kept unit, and none stays none', () => {
  const { deformTangent } = shaderRun<{
    deformTangent: (tangent: number[], normal: number[]) => number[]
  }>(wgslModule(DEFORM_WGSL), ['deformTangent'], {})
  // The normal tilted from +z toward +x: the tangent along x loses its share along it.
  const n = [0.6, 0, 0.8]
  const t = deformTangent([1, 0, 0], n)
  assert.ok(Math.abs(Math.hypot(...t) - 1) < 1e-6)
  assert.ok(Math.abs(t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) < 1e-6)
  // The page's own method: the tangent less its part along the normal, made unit.
  const along = n[0]
  const wanted = [1 - along * n[0], -along * n[1], -along * n[2]]
  const length = Math.hypot(...wanted)
  t.forEach((x, i) => assert.ok(Math.abs(x - wanted[i] / length) < 1e-6))
  // A normal the tangent already lies across leaves it; the normal's length is no matter.
  assert.deepEqual(deformTangent([0, 1, 0], [0, 0, 3]), [0, 1, 0])
  // A vertex that has no tangent has none after.
  assert.deepEqual(deformTangent([0, 0, 0], n), [0, 0, 0])
})
