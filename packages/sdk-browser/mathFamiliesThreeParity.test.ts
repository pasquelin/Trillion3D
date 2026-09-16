// Les familles de calcul qui ont remplacé Three sur le chemin par image (lot M3b), confrontées à
// la référence au bit près (`Object.is`) sur des cas hostiles : NaN, ±0, infinis, échelle négative.
//
//  - `transformAffinePoint` (`mathVector.ts`) remplace `Vector3.applyMatrix4` aux sites qui
//    reprojettent un point sans division perspective — `visibilityProjection.ts`,
//    `streamingPriority.ts`, `webgpuShadowBounds.ts`.
//  - `decomposeMatrix4` (`mathMatrix4Trs.ts`) remplace `Matrix4.decompose`, à commencer par
//    `enginePose` (`cameraWorld.ts`), sur une échelle négative — le cas qui distingue une
//    décomposition correcte d'une qui perdrait le signe.
//  - La vitesse de l'œil que le seuil adaptatif mesure (`pageSelectionRequests.ts`,
//    `resolvePixelError`) remplace `Vector3.distanceTo` par `Math.sqrt(dx·dx + dy·dy + dz·dz)` —
//    la même formule, terme à terme, que `distanceToSquared` de Three.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { decomposeMatrix4, transformAffinePoint } from '../sdk-core/index.ts';

function assertBits(actual: ArrayLike<number>, expected: ArrayLike<number>, quoi: string) {
  assert.equal(actual.length, expected.length, quoi);
  for (let i = 0; i < expected.length; i++)
    assert.ok(Object.is(actual[i], expected[i]), `${quoi}[${i}] : ${actual[i]} !== ${expected[i]}`);
}

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
  // Affine générique : rotation + cisaillement + translation quelconque.
  [1, 0.3, -0.2, 0, 0.4, 1, 0.1, 0, -0.1, 0.5, 1, 0, 3, -7, 12, 1],
  // ±0 et infinis dans la partie linéaire.
  [Infinity, 0, -0, 0, 0, -Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  // NaN.
  [1, 0, 0, 0, 0, NaN, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
];

for (const [i, m] of CAS_HOSTILES.entries()) {
  test(`transformAffinePoint === Vector3.applyMatrix4, cas hostile ${i}`, () => {
    const point = new THREE.Vector3(2.5, -3.25, 0.125).applyMatrix4(
      new THREE.Matrix4().fromArray(m),
    );
    const out = transformAffinePoint(new Float64Array(3), m, 2.5, -3.25, 0.125);
    assertBits(out, point.toArray(), 'point transformé');
  });
}

test('decomposeMatrix4 : échelle négative sur un seul axe, mêmes bits que Matrix4.decompose', () => {
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
  assertBits(s2, s.toArray(), 'échelle, signe compris');
  assert.ok(s2[0] < 0, 'témoin : l’axe négatif doit rester négatif après décomposition');
  const proche = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  assert.ok(
    ['x', 'y', 'z', 'w'].every((k, idx) =>
      proche(q2[idx], (q as unknown as Record<string, number>)[k]),
    ),
    'quaternion, à l’arrondi de la normalisation près',
  );
});

test('decomposeMatrix4 : deux axes négatifs (rotation pure), mêmes bits que Matrix4.decompose', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(-3, -3, 3),
  );
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const s2 = new Float64Array(3);
  decomposeMatrix4(m.elements, new Float64Array(3), new Float64Array(4), s2);
  assertBits(s2, s.toArray(), 'deux négatifs se recomposent en rotation, pas en réflexion');
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
  test(`resolvePixelError : la vitesse de l’œil (Math.sqrt(dx²+dy²+dz²)) égale Vector3.distanceTo, paire ${i}`, () => {
    const dx = a[0] - b[0],
      dy = a[1] - b[1],
      dz = a[2] - b[2];
    const obtenu = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const attendu = new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b));
    assert.ok(Object.is(obtenu, attendu), `${obtenu} !== ${attendu}`);
  });
}
