// Math families that replaced Three on per-frame path (batch M3b), compared with
// reference down to exact bit (`Object.is`) on hostile cases: NaN, ±0, infinities, negative scale.
//
//  - `transformAffinePoint` (`mathVector.ts`) replaces `Vector3.applyMatrix4` at sites
//    reprojecting a point without perspective divide — `../visibility/projection.ts`,
//    `../streaming/priority.ts`, `../webgpu/shadow/bounds.ts`.
//  - `decomposeMatrix4` (`mathMatrix4Trs.ts`) replaces `Matrix4.decompose`, starting with
//    `enginePose` (`../camera/world.ts`), on negative scale — case distinguishing correct
//    decomposition from one losing sign.
//  - Eye speed measured by adaptive threshold (`../page/selection/requests.ts`,
//    `resolvePixelError`) replaces `Vector3.distanceTo` by `Math.sqrt(dx·dx + dy·dy + dz·dz)` —
//    same term-by-term formula as Three's `distanceToSquared`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assertBits } from '../../../../tests/kit/assert/bits.ts';
import { decomposeMatrix4, transformAffinePoint } from '../../../sdk-core/src/index.ts';

const CAS_HOSTILES: Array<
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
];

for (const [i, m] of CAS_HOSTILES.entries()) {
  test(`transformAffinePoint === Vector3.applyMatrix4, hostile case ${i}`, () => {
    const point = new THREE.Vector3(2.5, -3.25, 0.125).applyMatrix4(
      new THREE.Matrix4().fromArray(m),
    );
    const out = transformAffinePoint(new Float64Array(3), m, 2.5, -3.25, 0.125);
    assertBits(out, point.toArray(), 'transformed point');
  });
}

test('decomposeMatrix4: negative scale on a single axis, same bits as Matrix4.decompose', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(4, -2, 7),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.6, 0.9)),
    new THREE.Vector3(-1.5, 3, 2),
  );
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  m.decompose(p, q, s);
  const p2 = new Float64Array(3),
    q2 = new Float64Array(4),
    s2 = new Float64Array(3);
  decomposeMatrix4(m.elements, p2, q2, s2);
  assertBits(p2, p.toArray(), 'position');
  assertBits(s2, s.toArray(), 'scale, including sign');
  assert.ok(s2[0] < 0, 'test: negative axis must remain negative after decomposition');
  const proche = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, idx) =>
      proche(q2[idx], (q as unknown as Record<string, number>)[k]),
    ),
    'quaternion, up to normalization rounding',
  );
});

test('decomposeMatrix4: two negative axes (pure rotation), same bits as Matrix4.decompose', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(-3, -3, 3),
  );
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const s2 = new Float64Array(3);
  decomposeMatrix4(m.elements, new Float64Array(3), new Float64Array(4), s2);
  assertBits(s2, s.toArray(), 'two negatives recompose as rotation, not reflection');
});

const PAIRES_HOSTILES: Array<[[number, number, number], [number, number, number]]> = [
  [
    [12.5, -3.25, 900.125],
    [-4.75, 6.5, -0.001],
  ],
  [
    [0, 0, 0],
    [-0, -0, -0],
  ],
  [
    [Infinity, 2, 3],
    [1, 2, 3],
  ],
  [
    [NaN, 2, 3],
    [1, 2, 3],
  ],
];

for (const [i, [a, b]] of PAIRES_HOSTILES.entries()) {
  test(`resolvePixelError: eye speed (Math.sqrt(dx²+dy²+dz²)) equals Vector3.distanceTo, pair ${i}`, () => {
    const dx = a[0] - b[0],
      dy = a[1] - b[1],
      dz = a[2] - b[2];
    const obtenu = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const attendu = new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
    assert.ok(Object.is(obtenu, attendu), `${obtenu} !== ${attendu}`);
  });
}
