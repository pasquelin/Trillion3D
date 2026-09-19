// Lot M2, mathFrustumBox.ts: box against viewing frustum — inside, outside, straddling, and a box
// intersecting the near plane —, compared against Three.js Frustum.intersectsBox and Frustum.containsPoint.
//
// Clipping is `[0, 1]` on both sides; only depth DIRECTION differs, which swaps the
// NEAR plane and the FAR plane. The six planes are therefore the same set, in another order — and
// a box verdict only reads a set.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  clipPlanesFromMatrix,
  frustumClipBox,
  frustumExcludesBox,
  frustumPlanesFromMatrix,
} from './index.ts';
import { boite3 } from './bench/oracles/volumes.mjs';

function camera() {
  const cam = new THREE.PerspectiveCamera(50, 1.3, 0.5, 200);
  cam.coordinateSystem = THREE.WebGPUCoordinateSystem;
  cam.updateProjectionMatrix();
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}
const vp = camera();
const tronc = new THREE.Frustum().setFromProjectionMatrix(vp, THREE.WebGPUCoordinateSystem);
const plans = new Float64Array(24);
frustumPlanesFromMatrix(plans, vp.elements);
const brut = new Float64Array(24);
clipPlanesFromMatrix(brut, vp.elements);

/** Three-way state built with public Three primitives, independent of mathFrustumBox.ts. */
function etatThree(b: number[]) {
  const box = boite3(b);
  if (!tronc.intersectsBox(box)) return 0;
  const coins = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new THREE.Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]),
  );
  return coins.every((c) => tronc.containsPoint(c)) ? 2 : 1;
}

// Camera is at z = 10, looking at origin: near plane (near = 0.5) cuts world at
// z = 9.5, inside of frustum is on z < 9.5 side.
test('box entirely inside, in front of near plane, yields 2 and is not excluded', () => {
  const b = [-0.15, -0.15, 9.0, 0.15, 0.15, 9.3];
  assert.equal(etatThree(b), 2);
  assert.equal(
    frustumClipBox(plans, ...(b as [number, number, number, number, number, number])),
    2,
  );
  assert.equal(
    frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('box entirely outside, far to the side, yields 0 and is excluded', () => {
  const b = [500, 500, 500, 501, 501, 501];
  assert.equal(etatThree(b), 0);
  assert.equal(
    frustumClipBox(plans, ...(b as [number, number, number, number, number, number])),
    0,
  );
  assert.equal(
    frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])),
    true,
  );
});

test('box straddling left plane, far from near plane, yields 1 and is not excluded', () => {
  const b = [5, -0.5, -1, 7, 0.5, 1];
  assert.equal(etatThree(b), 1);
  assert.equal(
    frustumClipBox(plans, ...(b as [number, number, number, number, number, number])),
    1,
  );
  assert.equal(
    frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('box intersecting near plane (z = 9.5) yields 1, never 0 nor 2', () => {
  const b = [-0.3, -0.3, 9.3, 0.3, 0.3, 9.7];
  assert.equal(etatThree(b), 1);
  const etat = frustumClipBox(plans, ...(b as [number, number, number, number, number, number]));
  assert.equal(etat, 1);
  assert.equal(
    frustumExcludesBox(plans, ...(b as [number, number, number, number, number, number])),
    false,
  );
});

test('verdict is identical with raw (unnormalized) planes and normalized planes', () => {
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

test('hostile box (NaN or inverted bounds) never rejects: comparison with NaN always fails', () => {
  assert.equal(frustumExcludesBox(plans, NaN, 0, 9, 0, 0, 10), false);
  assert.equal(frustumExcludesBox(plans, 1, 1, 1, -1, -1, -1), false); // inverted
});
