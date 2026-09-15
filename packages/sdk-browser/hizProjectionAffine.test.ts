import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { projectCornersInto } from './hizCorners.ts';

const camera = () => {
  const cam = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 5000);
  cam.position.set(3, 2, 12);
  cam.rotation.set(-0.2, 0.4, 0);
  cam.updateMatrixWorld(true);
  return cam;
};

/** Les huit coins monde d'une boîte alignée, dans l'ordre que la projection lit. */
function coins(center: readonly [number, number, number], half: number) {
  const out = new Float64Array(24);
  for (let i = 0; i < 8; i++) {
    out[i * 3] = center[0] + (i & 1 ? half : -half);
    out[i * 3 + 1] = center[1] + (i & 2 ? half : -half);
    out[i * 3 + 2] = center[2] + (i & 4 ? half : -half);
  }
  return out;
}

function rectangle(
  corners: Float64Array,
  view: THREE.Matrix4,
  viewProj: THREE.Matrix4,
  near: number,
) {
  const into = new Float64Array(HIZ_BOUNDS_VALUES);
  projectCornersInto(corners, 0, view.elements, viewProj.elements, near, 1280, 720, into, 0);
  return [...into];
}

test('une vue affine rend un dénominateur exactement 1, et la division reste vivante sans elle', () => {
  const cam = camera();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  const v = cam.matrixWorldInverse.elements;
  assert.deepEqual([v[3], v[7], v[11], v[15]], [0, 0, 0, 1], 'la vue d’une caméra est affine');
  // C'est tout ce sur quoi le raccourci repose : pour un coin fini, le dénominateur du passage en
  // espace de vue vaut exactement 1, et multiplier par 1 rend la même valeur que diviser par 1.
  const box = coins([0, 0, -60], 4);
  for (let i = 0; i < 8; i++) {
    const x = box[i * 3],
      y = box[i * 3 + 1],
      z = box[i * 3 + 2];
    assert.equal(v[3] * x + v[7] * y + v[11] * z + v[15], 1);
  }
  // Une vue qui n'est pas affine emprunte la division ; elle n'entre que dans le test du plan
  // proche, pas dans le rectangle, que la matrice de vue-projection décide seule.
  const projective = cam.matrixWorldInverse.clone();
  projective.elements[15] = 2;
  assert.deepEqual(
    rectangle(box, projective, viewProj, cam.near),
    rectangle(box, cam.matrixWorldInverse, viewProj, cam.near),
  );
});

test('une boîte qui coupe le plan proche rend l’enregistrement coupé, sans lire ses autres coins', () => {
  const cam = camera();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  // Une boîte autour de l'œil : son premier coin est déjà derrière le plan proche.
  const around = coins([cam.position.x, cam.position.y, cam.position.z], 5);
  const coupe = rectangle(around, cam.matrixWorldInverse, viewProj, cam.near);
  assert.deepEqual(coupe, [0, 0, 0, 0, 0, 1]);
  // Les coins que la boucle n'a plus à lire peuvent être n'importe quoi : le verdict ne bouge pas.
  const abimee = Float64Array.from(around);
  for (let k = 3; k < 24; k++) abimee[k] = NaN;
  assert.deepEqual(rectangle(abimee, cam.matrixWorldInverse, viewProj, cam.near), coupe);

  // Une boîte entièrement devant garde, elle, un rectangle et une profondeur.
  const devant = rectangle(coins([0, 0, -60], 4), cam.matrixWorldInverse, viewProj, cam.near);
  assert.equal(devant[5], 0);
  assert.ok(devant[2] > devant[0] && devant[3] > devant[1]);
  assert.ok(devant[4] > 0 && devant[4] < 1);
});
