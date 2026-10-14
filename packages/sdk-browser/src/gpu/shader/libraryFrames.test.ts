// The frame, cofactor and projection declarations of the maths library
// (`packages/math/src/wgsl/basis.ts`, `matrix.ts`, `projection.ts`), their shipped text run in
// JavaScript against what each one claims: an orthonormal frame, det · M⁻ᵀ, a pixel and a uv.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { Mat } from '../../texture/shaderRunMatrix.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  frameAround,
  intoFrame,
  outOfFrame,
  tangentAcross,
} from '../../../../math/src/wgsl/basis.ts'
import { cofactor3 } from '../../../../math/src/wgsl/matrix.ts'
import {
  clipToFramebuffer,
  ndcToPixel,
  perspectiveDivide,
  transformHomogeneousPoint,
} from '../../../../math/src/wgsl/projection.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'

type V = number[]
type F = (...args: never[]) => never
const run = shaderRun<Record<string, F>>(
  wgslModule(
    tangentAcross,
    frameAround,
    intoFrame,
    outOfFrame,
    cofactor3,
    ndcToPixel,
    clipToFramebuffer,
    perspectiveDivide,
    transformHomogeneousPoint,
  ),
  [
    'tangentAcross',
    'frameAround',
    'intoFrame',
    'outOfFrame',
    'cofactor3',
    'ndcToPixel',
    'clipToFramebuffer',
    'perspectiveDivide',
    'transformHomogeneousPoint',
  ],
  { Frame3: (x: V, y: V, z: V) => ({ x, y, z }), mat3x3f: (...columns: V[]) => columns },
) as unknown as Record<string, (...args: unknown[]) => never>
/** Unit vectors spread over the sphere, both hemispheres and the poles. */
const UNITS = [
  ...Array.from({ length: 64 }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / 64,
      r = Math.sqrt(1 - z * z),
      a = i * 2.399963
    return [r * Math.cos(a), r * Math.sin(a), z]
  }),
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [0, 1, 0],
]

test('the tangent across is across the direction and x, null along ±x', () => {
  for (const N of UNITS) {
    const t: V = run.tangentAcross(N)
    nearRelative(dotVector3(t, N), 0, 'across')
    const axis = Math.abs(N[0]) > 1e-6 ? 0 : 1
    nearRelative(dotVector3(t, t), 1 - N[axis] ** 2, `length at ${N}`)
  }
  assert.deepEqual(run.tangentAcross([1, 0, 0]), [0, 0, 0])
})

test('the frame around an axis is orthonormal, right-handed, its z the axis', () => {
  for (const N of UNITS) {
    const m: { x: V; y: V; z: V } = run.frameAround(N)
    assert.deepEqual(m.z, N)
    for (const [a, b, want] of [
      [m.x, m.x, 1],
      [m.y, m.y, 1],
      [m.x, m.y, 0],
      [m.x, m.z, 0],
      [m.y, m.z, 0],
    ] as [V, V, number][])
      nearRelative(dotVector3(a, b), want, `frame of ${N}`)
    const xy = [
      m.x[1] * m.y[2] - m.x[2] * m.y[1],
      m.x[2] * m.y[0] - m.x[0] * m.y[2],
      m.x[0] * m.y[1] - m.x[1] * m.y[0],
    ]
    nearRelative(dotVector3(xy, N), 1, `right-handed at ${N}`)
    const v = [0.3, -1.7, 2.2]
    const back: V = run.outOfFrame(run.intoFrame(m, v), m)
    back.forEach((x, i) => nearRelative(x, v[i], 'into then out of the frame'))
  }
})

test('the cofactor matrix is det · M⁻ᵀ: each column of M against it gives det on the diagonal', () => {
  const [a, b, c] = [
    [2, 0.5, -1],
    [0.3, 3, 0.7],
    [-0.4, 1.1, 1.5],
  ]
  const C: V[] = run.cofactor3(a, b, c)
  const det = dotVector3(a, C[0])
  nearRelative(
    det,
    2 * (3 * 1.5 - 0.7 * 1.1) - 0.3 * (0.5 * 1.5 + 1 * 1.1) - 0.4 * (0.5 * 0.7 + 1 * 3),
    'det',
  )
  ;[a, b, c].forEach((column, i) =>
    C.forEach((row, j) => nearRelative(dotVector3(column, row), i === j ? det : 0, `${i}${j}`)),
  )
})

test('the pixel of a clip point is ndcToPixel of its divided xy, its depth beside', () => {
  for (const clip of [
    [-2, -2, 1, 2],
    [1, 1, 0.5, 1],
    [0.25, -0.6, 0.3, 0.5],
  ]) {
    const divided: V = run.perspectiveDivide(clip)
    const pixel: V = run.ndcToPixel(divided.slice(0, 2), [640, 360])
    assert.deepEqual(run.clipToFramebuffer(clip, [640, 360]), [...pixel, divided[2]])
  }
  assert.deepEqual(run.ndcToPixel([-1, 1], [640, 360]), [0, 0])
  assert.deepEqual(run.ndcToPixel([1, -1], [640, 360]), [640, 360])
  const m = new Mat([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 1, 5, 6, 7, 0])
  assert.deepEqual(run.transformHomogeneousPoint(m, [1, 1, 1]), [7, 9, 11, 1])
})

test('the perspective divide is each of the three first lanes over the fourth', () => {
  assert.deepEqual(run.perspectiveDivide([2, -4, 6, 2]), [1, -2, 3])
  assert.deepEqual(run.perspectiveDivide([1, 3, -5, -0.5]), [-2, -6, 10])
  assert.deepEqual(run.perspectiveDivide([0.5, 0.25, 8, 4]), [0.125, 0.0625, 2])
})
