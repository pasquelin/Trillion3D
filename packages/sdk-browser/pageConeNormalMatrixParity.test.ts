// `normalMatrix3` (`mathMatrix3.ts`) replaces `Matrix3.getNormalMatrix`: `coneContextFor`
// (`pageCone.ts`) used to hold the matrix twice, once by Three, now once by the base. Two
// levels: the function alone, on hostile 3×3s (shear, non-conformal, NaN, ±0) where Three stays
// the reference even if `coneContextFor` rejects them; then the real site, under a negative
// scale — the only conformal case `isConformal` keeps without being a simple rotation — to check
// that `into.normal` AND the eye position (`cam.eye`, under a host rig) are the right ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalMatrix3 } from '../sdk-core/index.ts';
import { coneContextFor, createConeContext } from './pageCone.ts';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';

function assertBits(actual: ArrayLike<number>, expected: ArrayLike<number>, quoi: string) {
  assert.equal(actual.length, expected.length, quoi);
  for (let i = 0; i < expected.length; i++)
    assert.ok(Object.is(actual[i], expected[i]), `${quoi}[${i}] : ${actual[i]} !== ${expected[i]}`);
}

/** The nine coefficients of Three's 3×3, column-major, flat. */
const a9 = (m: THREE.Matrix3) => Float64Array.from(m.elements);

const CAS_HOSTILES: THREE.Matrix4[] = [
  // Shear: y pushes x, z pushes y.
  new THREE.Matrix4().set(1, 0, 0, 0, 0.6, 1, 0, 0, 0, 0.3, 1, 0, 0, 0, 0, 1),
  // Non-uniform scale, one negative axis.
  new THREE.Matrix4().makeScale(2, -3, 0.5),
];

for (const [i, m] of CAS_HOSTILES.entries()) {
  test(`normalMatrix3 === Matrix3.getNormalMatrix, hostile case ${i}`, () => {
    const ref = new THREE.Matrix3().getNormalMatrix(m);
    const out = new Float64Array(9);
    normalMatrix3(out, m.elements);
    assertBits(out, a9(ref), 'normal matrix');
  });
}

test("normalMatrix3: on a non-finite 3×3, the engine convention replaces Three's", () => {
  // Parity with Three holds on REGULAR matrices, and it stops there: the engine has its own
  // convention for singular matrices (the adjugate, `mathMatrix3.ts`) and for non-finite scales
  // (nine zeros, the rule of `mathSingular.ts`, that of the WGSL kernel). Three, on this NaN
  // mixed with ±0, used to propagate NaNs into the nine terms — therefore into the cone axis,
  // then into lighting. This test holds the gap, rather than let parity one day take it back.
  const m = new THREE.Matrix4().set(NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const ref = a9(new THREE.Matrix3().getNormalMatrix(m));
  assert.ok(
    [...ref].every((v) => Number.isNaN(v)),
    `Three used to yield nine NaNs, got ${[...ref]}`,
  );
  const out = new Float64Array(9).fill(9);
  normalMatrix3(out, m.elements);
  assertBits(out, new Float64Array(9), 'engine normal matrix');
});

test("coneContextFor: the normal matrix and the eye position are Three's, negative scale included, under a rig", () => {
  const grandparent = new THREE.Object3D();
  grandparent.position.set(3, -1, 4);
  grandparent.quaternion.setFromEuler(new THREE.Euler(0.2, 0.5, -0.3));
  const parent = new THREE.Object3D();
  parent.position.set(-2, 6, 1);
  parent.quaternion.setFromEuler(new THREE.Euler(-0.4, 0.1, 0.6));
  grandparent.add(parent);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 0, 5);
  parent.add(camera);
  camera.updateWorldMatrix(true, false);

  // Conformal: rotation + uniform negative scale (determinant < 0, orthogonal columns).
  const world = new THREE.Object3D();
  world.quaternion.setFromEuler(new THREE.Euler(0.3, -0.2, 0.7));
  world.scale.set(-2, -2, -2);
  world.updateMatrix();

  const cam = readCameraWorld(createEngineCamera(), camera);
  const ctx = coneContextFor(createConeContext(), world.matrix, cam.eye);
  assert.equal(ctx.conformal, true, 'witness: a uniform negative scale must stay conformal');
  assertBits(ctx.normal, a9(new THREE.Matrix3().getNormalMatrix(world.matrix)), 'normal matrix');
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  assertBits([ctx.camX, ctx.camY, ctx.camZ], eye.toArray(), 'eye position, ancestors included');
  assert.notDeepEqual(
    [ctx.camX, ctx.camY, ctx.camZ],
    camera.position.toArray(),
    'witness: the local pose under the rig is not the right answer',
  );
});
