// Lot M2, mathSphere.ts : sphère englobante d'une boîte, confrontée à Box3.getBoundingSphere de
// Three.js au bit près (Object.is), boîte vide comprise.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxTransform, sphereFromBounds } from './index.ts';

const boite3 = (b: ArrayLike<number>) =>
  new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
function assertBits(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(actual[i], expected[i]),
      `composante ${i} : ${actual[i]} !== ${expected[i]}`,
    );
}
const sphereRef = (b: ArrayLike<number>) => {
  const s = boite3(b).getBoundingSphere(new THREE.Sphere());
  return Float64Array.of(s.center.x, s.center.y, s.center.z, s.radius);
};

test('sphereFromBounds s’accorde avec Box3.getBoundingSphere pour des boîtes ordinaires, ponctuelles et extrêmes', () => {
  const boites = [
    [-1, -2, -3, 4, 5, 6],
    [2, 3, 4, 2, 3, 4], // ponctuelle : rayon nul
    [-1e308, -1e308, -1e308, 1e308, 1e308, 1e308],
    [-0, -0, -0, 0, 0, 0],
  ];
  for (const b of boites) {
    const obtenu = new Float64Array(4);
    sphereFromBounds(obtenu, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
    assertBits(obtenu, sphereRef(b));
  }
});

test('une boîte vide (bornes inversées) rend la sphère vide : centre nul, rayon -1', () => {
  const inversee = [1, 1, 1, -1, -1, -1];
  const obtenu = new Float64Array(4);
  sphereFromBounds(
    obtenu,
    0,
    inversee[0],
    inversee[1],
    inversee[2],
    inversee[3],
    inversee[4],
    inversee[5],
  );
  assertBits(obtenu, sphereRef(inversee));
  assertBits(obtenu, Float64Array.of(0, 0, 0, -1));
});

test('sphereFromBounds après boxTransform s’accorde avec Box3.applyMatrix4 puis getBoundingSphere', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 1.4, 0.2));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(3, -2, 1),
    q,
    new THREE.Vector3(0.5, 4, -2),
  );
  const b = [-2, -1, -3, 1, 2, 4];
  const attendu = sphereRef(aPlatDeApplyMatrix4(b, m));
  const boiteTransformee = new Float64Array(6);
  boxTransform(boiteTransformee, 0, b, 0, m.elements);
  const obtenu = new Float64Array(4);
  sphereFromBounds(
    obtenu,
    0,
    boiteTransformee[0],
    boiteTransformee[1],
    boiteTransformee[2],
    boiteTransformee[3],
    boiteTransformee[4],
    boiteTransformee[5],
  );
  assertBits(obtenu, attendu);
});

function aPlatDeApplyMatrix4(b: number[], m: THREE.Matrix4) {
  const box = boite3(b).applyMatrix4(m);
  return Float64Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
}
