// `normalMatrix3` (`mathMatrix3.ts`) remplace `Matrix3.getNormalMatrix` : `coneContextFor`
// (`pageCone.ts`) en tenait deux fois la matrice, une fois par Three, désormais une par le socle.
// Deux niveaux : la fonction seule, sur des 3×3 hostiles (cisaillement, non conforme, NaN, ±0) où
// Three reste la référence même si `coneContextFor` les écarte ; puis le site réel, sous une échelle
// négative — le seul cas conforme que `isConformal` retient sans être une simple rotation — pour
// vérifier que `into.normal` ET la position d'œil (`cam.eye`, sous un rig d'hôte) sont les bonnes.
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

/** Les neuf coefficients de la 3×3 de Three, colonne-major, à plat. */
const a9 = (m: THREE.Matrix3) => Float64Array.from(m.elements);

const CAS_HOSTILES: THREE.Matrix4[] = [
  // Cisaillement : y pousse x, z pousse y.
  new THREE.Matrix4().set(1, 0, 0, 0, 0.6, 1, 0, 0, 0, 0.3, 1, 0, 0, 0, 0, 1),
  // Échelle non uniforme, un axe négatif.
  new THREE.Matrix4().makeScale(2, -3, 0.5),
  // NaN et ±0.
  new THREE.Matrix4().set(NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
];

for (const [i, m] of CAS_HOSTILES.entries()) {
  test(`normalMatrix3 === Matrix3.getNormalMatrix, cas hostile ${i}`, () => {
    const ref = new THREE.Matrix3().getNormalMatrix(m);
    const out = new Float64Array(9);
    normalMatrix3(out, m.elements);
    assertBits(out, a9(ref), 'matrice normale');
  });
}

test('coneContextFor : la matrice normale et la position d’œil sont celles de Three, échelle négative comprise, sous un rig', () => {
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

  // Conforme : rotation + échelle négative uniforme (déterminant < 0, colonnes orthogonales).
  const world = new THREE.Object3D();
  world.quaternion.setFromEuler(new THREE.Euler(0.3, -0.2, 0.7));
  world.scale.set(-2, -2, -2);
  world.updateMatrix();

  const cam = readCameraWorld(createEngineCamera(), camera);
  const ctx = coneContextFor(createConeContext(), world.matrix, cam);
  assert.equal(ctx.conformal, true, 'témoin : une échelle négative uniforme doit rester conforme');
  assertBits(ctx.normal, a9(new THREE.Matrix3().getNormalMatrix(world.matrix)), 'matrice normale');
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  assertBits([ctx.camX, ctx.camY, ctx.camZ], eye.toArray(), 'position d’œil, ancêtres compris');
  assert.notDeepEqual(
    [ctx.camX, ctx.camY, ctx.camZ],
    camera.position.toArray(),
    'témoin : la pose locale sous le rig n’est pas la bonne réponse',
  );
});
