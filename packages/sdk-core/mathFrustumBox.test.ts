// Lot M2, mathFrustumBox.ts : boîte contre le tronc de vue — dedans, dehors, à cheval, et une boîte
// qui coupe le plan proche —, confrontée à Frustum.intersectsBox et Frustum.containsPoint de Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumClipBox, frustumExcludesBox, frustumPlanesFromMatrix } from './index.ts';

function camera() {
  const cam = new THREE.PerspectiveCamera(50, 1.3, 0.5, 200);
  cam.coordinateSystem = THREE.WebGLCoordinateSystem;
  cam.updateProjectionMatrix();
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}
const vp = camera();
const tronc = new THREE.Frustum().setFromProjectionMatrix(vp, THREE.WebGLCoordinateSystem);
const plans = new Float64Array(24);
frustumPlanesFromMatrix(plans, vp.elements, false);
const brut = new Float64Array(24);
clipPlanesFromMatrix(brut, vp.elements);

function box3(b: number[]) {
  return new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
}
/** État à trois voies bâti avec les primitives publiques de Three, indépendant de mathFrustumBox.ts. */
function etatThree(b: number[]) {
  const box = box3(b);
  if (!tronc.intersectsBox(box)) return 0;
  const coins = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]),
  );
  return coins.every((c) => tronc.containsPoint(c)) ? 2 : 1;
}

// La caméra est en z = 10, regarde vers l'origine : le plan proche (near = 0.5) coupe le monde à
// z = 9.5, l'intérieur du tronc est du côté z < 9.5.
test('une boîte entièrement dedans, avant le plan proche, rend 2 et n’est pas exclue', () => {
  const b = [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3];
  assert.equal(etatThree(b), 2);
  assert.equal(frustumClipBox(plans, ...(b as [number, number, number, number, number, number])), 2);
  assert.equal(frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])), false);
});

test('une boîte entièrement dehors, loin sur le côté, rend 0 et est exclue', () => {
  const b = [500, 500, 500, 501, 501, 501];
  assert.equal(etatThree(b), 0);
  assert.equal(frustumClipBox(plans, ...(b as [number, number, number, number, number, number])), 0);
  assert.equal(frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])), true);
});

test('une boîte à cheval sur le plan gauche, loin du plan proche, rend 1 et n’est pas exclue', () => {
  const b = [5, -0.5, -1, 7, 0.5, 1];
  assert.equal(etatThree(b), 1);
  assert.equal(frustumClipBox(plans, ...(b as [number, number, number, number, number, number])), 1);
  assert.equal(frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])), false);
});

test('une boîte qui coupe le plan proche (z = 9.5) rend 1, jamais 0 ni 2', () => {
  const b = [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7];
  assert.equal(etatThree(b), 1);
  const etat = frustumClipBox(plans, ...(b as [number, number, number, number, number, number]));
  assert.equal(etat, 1);
  assert.equal(frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])), false);
});

test('le verdict est le même avec les plans bruts (non normalisés) qu’avec les plans normalisés', () => {
  const boites = [
    [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3],
    [500, 500, 500, 501, 501, 501],
    [5, -0.5, -1, 7, 0.5, 1],
    [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7],
  ];
  for (const b of boites) {
    const c = b as [number, number, number, number, number, number];
    assert.equal(frustumClipBox(brut, ...c), frustumClipBox(plans, ...c));
    assert.equal(frustumExcludesBox(brut, ...c), frustumExcludesBox(plans, ...c));
  }
});

test('une boîte hostile (bornes NaN ou inversées) ne rejette jamais : une comparaison avec NaN échoue toujours', () => {
  assert.equal(frustumExcludesBox(plans, NaN, 0, 9, 0, 0, 10), false);
  assert.equal(frustumExcludesBox(plans, 1, 1, 1, -1, -1, -1), false); // inversée
});
