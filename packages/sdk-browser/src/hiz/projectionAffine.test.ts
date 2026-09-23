import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { projectCornersInto } from './corners.ts';

const camera = () => {
  const cam = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 5000);
  cam.position.set(3, 2, 12);
  cam.rotation.set(-0.2, 0.4, 0);
  cam.updateMatrixWorld(true);
  return cam;
};

/** The eight world corners of an aligned box, in the order the projection reads. */
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

test('an affine view yields a denominator of exactly 1, and the division stays live without it', () => {
  const cam = camera();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  const v = cam.matrixWorldInverse.elements;
  assert.deepEqual([v[3], v[7], v[11], v[15]], [0, 0, 0, 1], "a camera's view is affine");
  // That is all the shortcut rests on: for a finite corner, the view-space passage denominator
  // is exactly 1, and multiplying by 1 yields the same value as dividing by 1.
  const box = coins([0, 0, -60], 4);
  for (let i = 0; i < 8; i++) {
    const x = box[i * 3],
      y = box[i * 3 + 1],
      z = box[i * 3 + 2];
    assert.equal(v[3] * x + v[7] * y + v[11] * z + v[15], 1);
  }
  // A view that is not affine takes the division; it only enters the near-plane test, not the
  // rectangle, which the view-projection matrix decides alone.
  const projective = cam.matrixWorldInverse.clone();
  projective.elements[15] = 2;
  assert.deepEqual(
    rectangle(box, projective, viewProj, cam.near),
    rectangle(box, cam.matrixWorldInverse, viewProj, cam.near),
  );
});

test('a box that clips the near plane returns the clipped record, without reading its other corners', () => {
  const cam = camera();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  // A box around the eye: its first corner is already behind the near plane.
  const around = coins([cam.position.x, cam.position.y, cam.position.z], 5);
  const coupe = rectangle(around, cam.matrixWorldInverse, viewProj, cam.near);
  assert.deepEqual(coupe, [0, 0, 0, 0, 0, 1]);
  // Corners the loop no longer has to read can be anything: the verdict does not move.
  const abimee = Float64Array.from(around);
  for (let k = 3; k < 24; k++) abimee[k] = NaN;
  assert.deepEqual(rectangle(abimee, cam.matrixWorldInverse, viewProj, cam.near), coupe);

  // A box entirely in front, for its part, keeps a rectangle and a depth.
  const devant = rectangle(coins([0, 0, -60], 4), cam.matrixWorldInverse, viewProj, cam.near);
  assert.equal(devant[5], 0);
  assert.ok(devant[2] > devant[0] && devant[3] > devant[1]);
  assert.ok(devant[4] > 0 && devant[4] < 1);
});
