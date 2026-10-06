import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { cross, subtract } from '../../../../sdk-core/src/math/primitives/vectorTuple.ts'
import { SHADING_POINT_WGSL } from './shadingPoint.ts'
import { random as seeded } from '../../page/cut/cutRuleChecks.fixture.ts'

type V = number[]
const { shadingPointOffset } = shaderRun<{
  shadingPointOffset: (...vectors: V[]) => V
}>(SHADING_POINT_WGSL, ['shadingPointOffset'], {})
const dot = (a: V, b: V) => a.reduce((v, x, i) => v + x * b[i], 0)
const unit = (a: V) => a.map((x) => x / Math.hypot(...a))

test('receiver projects onto interpolated vertex tangent planes and keeps flat surfaces exact', () => {
  const vertices = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ]
  const bary = [0.2, 0.3, 0.5]
  const P = [0.6, 1, 0]
  const normal = [0, 0, 1]
  assert.deepEqual(
    shadingPointOffset(P, bary, ...vertices, normal, normal, normal).map(Math.abs),
    [0, 0, 0],
  )
  const normals = [
    [-0.3, -0.3, 1],
    [0.3, 0, 1],
    [0, 0.3, 1],
  ].map(unit)
  const actual = shadingPointOffset(P, bary, ...vertices, ...normals)
  // Independent construction: each tangent-plane projection, then barycentric interpolation.
  const projected = vertices.map((v, i) => {
    const signedDistance = dot(
      P.map((x, j) => x - v[j]),
      normals[i],
    )
    return P.map((x, j) => x - signedDistance * normals[i][j])
  })
  actual.forEach((offset, j) => {
    const expected = projected.reduce((v, q, i) => v + bary[i] * q[j], 0)
    assert.ok(Math.abs(P[j] + offset - expected) < 1e-12)
  })
  assert.ok(actual[2] > 0, 'a convex smooth patch raises the shadow receiver')
  const flipped = shadingPointOffset(P, bary, ...vertices, ...normals.map((n) => n.map((x) => -x)))
  assert.deepEqual(
    flipped.map(Math.abs),
    [0, 0, 0],
    'seen from its other side, the patch is concave',
  )
  assert.deepEqual(
    shadingPointOffset(vertices[0], [1, 0, 0], ...vertices, ...normals).map(Math.abs),
    [0, 0, 0],
  )
})

test('degenerate normals and world translations preserve a finite receiver displacement', () => {
  const p = [4, 5, 6],
    zero = [0, 0, 0]
  assert.deepEqual(shadingPointOffset(p, [1, 0, 0], p, p, p, zero, zero, zero).map(Math.abs), zero)
  const vertices = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
    ],
    bary = [0.25, 0.25, 0.5]
  const normals = [
    [0, 0, 1],
    [0.2, 0, 1],
    [0, 0.2, 1],
  ].map(unit)
  const point = [0.5, 1, 0],
    translation = [128, -64, 32]
  const move = (v: V) => v.map((x, i) => x + translation[i])
  assert.deepEqual(
    shadingPointOffset(move(point), bary, ...vertices.map(move), ...normals),
    shadingPointOffset(point, bary, ...vertices, ...normals),
  )
})

test('the receiver never falls behind its triangle: a concave patch keeps its point', () => {
  const vertices = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ]
  // A dish's face: its normals lean toward each other.
  const concave = [
    [0.3, 0.3, 1],
    [-0.3, 0, 1],
    [0, -0.3, 1],
  ].map(unit)
  assert.deepEqual(
    shadingPointOffset([0.6, 1, 0], [0.2, 0.3, 0.5], ...vertices, ...concave).map(Math.abs),
    [0, 0, 0],
  )
  // Any triangle, any normals on one side of it: the receiver stays on or in front of it.
  const next = seeded(1344),
    random = () => next() * 2 - 1
  for (let i = 0; i < 500; i++) {
    const p = [0, 1, 2].map(() => [random(), random(), random()].map((x) => x * 4))
    const face = cross(subtract(p[1], p[0]), subtract(p[2], p[0]))
    const n = [0, 1, 2].map(() => unit(face.map((x) => x + random() * Math.hypot(...face))))
    const w = [Math.abs(random()), Math.abs(random()), Math.abs(random())]
    const bary = w.map((x) => x / (w[0] + w[1] + w[2]))
    const P = [0, 1, 2].map((j) => bary.reduce((v, b, k) => v + b * p[k][j], 0))
    const offset = shadingPointOffset(P, bary, ...p, ...n)
    const front = Math.sign(
      dot(
        face,
        n[0].map((x, j) => x + n[1][j] + n[2][j]),
      ),
    )
    assert.ok(front * dot(offset, face) >= 0, `triangle ${i}: receiver behind its surface`)
  }
})
