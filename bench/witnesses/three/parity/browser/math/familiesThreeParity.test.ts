// Math families that replaced the host-scene arithmetic on per-frame path, compared with
// that arithmetic down to exact bit (`Object.is`) on hostile cases: NaN, ±0, infinities, negative scale.
//
//  - `transformAffinePoint` (`packages/sdk-core/src/math/primitives/vector.ts`) replaces `Vector3.applyMatrix4` at sites
//    reprojecting a point without perspective divide — `packages/sdk-browser/src/visibility/projection.ts`.
//  - `decomposeMatrix4` (`packages/sdk-core/src/math/matrix/matrix4Trs.ts`) replaces `Matrix4.decompose`, starting with
//    `enginePose` (`packages/sdk-browser/src/camera/world.ts`), on negative scale — case distinguishing correct
//    decomposition from one losing sign.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import {
  decomposeMatrix4,
  transformAffinePoint,
} from '../../../../../../packages/sdk-core/src/index.ts'

const HOSTILE_CASES: Array<
  [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
> = [
  // Generic affine: rotation + shear + arbitrary translation.
  [1, 0.3, -0.2, 0, 0.4, 1, 0.1, 0, -0.1, 0.5, 1, 0, 3, -7, 12, 1],
  // ±0 and infinities in linear part.
  [Infinity, 0, -0, 0, 0, -Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  // NaN.
  [1, 0, 0, 0, 0, NaN, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
]

for (const [i, m] of HOSTILE_CASES.entries()) {
  test(`transformAffinePoint === Vector3.applyMatrix4, hostile case ${i}`, () => {
    const point = new THREE.Vector3(2.5, -3.25, 0.125).applyMatrix4(
      new THREE.Matrix4().fromArray(m),
    )
    const out = transformAffinePoint(new Float64Array(3), m, 2.5, -3.25, 0.125)
    assertBits(out, point.toArray(), 'transformed point')
  })
}

test('decomposeMatrix4: negative scale on a single axis, same bits as Matrix4.decompose', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(4, -2, 7),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.6, 0.9)),
    new THREE.Vector3(-1.5, 3, 2),
  )
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3()
  m.decompose(p, q, s)
  const p2 = new Float64Array(3),
    q2 = new Float64Array(4),
    s2 = new Float64Array(3)
  decomposeMatrix4(m.elements, p2, q2, s2)
  assertBits(p2, p.toArray(), 'position')
  assertBits(s2, s.toArray(), 'scale, including sign')
  assert.ok(s2[0] < 0, 'test: negative axis must remain negative after decomposition')
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, idx) =>
      close(q2[idx], (q as unknown as Record<string, number>)[k]),
    ),
    'quaternion, up to normalization rounding',
  )
})

test('decomposeMatrix4: two negative axes (pure rotation), same bits as Matrix4.decompose', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(-3, -3, 3),
  )
  const s = new THREE.Vector3()
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
  const s2 = new Float64Array(3)
  decomposeMatrix4(m.elements, new Float64Array(3), new Float64Array(4), s2)
  assertBits(s2, s.toArray(), 'two negatives recompose as rotation, not reflection')
})
