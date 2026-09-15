// A6 : boxClip rejette en une première passe, puis distingue traversé de dedans en une seconde qui
// s'arrête au premier plan traversé ; le signe du plan choisit le sommet par indice. Oracle : la
// version à une passe et une branche par sommet, d'avant le lot A, dans
// `bench/oracles/selection.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxClip, extractPlanes } from './pageSelectionMath.ts';
import { referenceBoxClip } from './bench/oracles/selection.mjs';

const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
cam.position.z = 6;
cam.lookAt(0, 0, 0);
cam.updateMatrixWorld();
const clip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const planes = new Float64Array(24);
extractPlanes(clip, planes);

function agree(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  const optimisee = boxClip(planes, minX, minY, minZ, maxX, maxY, maxZ);
  const reference = referenceBoxClip(planes, minX, minY, minZ, maxX, maxY, maxZ);
  assert.equal(optimisee, reference, `boxClip(${minX},${minY},${minZ},${maxX},${maxY},${maxZ})`);
  return optimisee;
}

test('a box fully outside the frustum is rejected (0), one straddling the far plane is not fully inside (1)', () => {
  assert.equal(agree(1000, 1000, 1000, 1001, 1001, 1001), 0);
  assert.equal(agree(-1000, -1000, -1000, 1000, 1000, 1000), 1);
});

test('a small box near the origin is fully inside (2)', () => {
  assert.equal(agree(-0.5, -0.5, -1, 0.5, 0.5, 1), 2);
});

test('a zero-volume (degenerate) box at the origin is treated as fully inside', () => {
  assert.equal(agree(0, 0, -1, 0, 0, -1), 2);
});

test('min and max swapped (an inverted box) still agrees with the reference term for term', () => {
  agree(1000, 1000, 1000, -1000, -1000, -1000);
  agree(0.5, 0.5, -1, -0.5, -0.5, -1);
});

test('NaN and Infinity corners never crash and match the reference bit for bit', () => {
  agree(NaN, 0, -1, NaN, 0, -1);
  agree(-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity);
  agree(-0, -0, -1, 0, 0, -1);
});

test('a plane with a zero coefficient picks the min-side vertex by index, both signs of every axis', () => {
  // Exercise every combination of plane-normal signs by scanning boxes whose extents cross zero on
  // each axis independently, so `a > 0 ? max : min` is hit both ways for a, b and c.
  for (const [minX, maxX] of [
    [-2, -1],
    [-1, 2],
    [1, 2],
  ])
    for (const [minY, maxY] of [
      [-2, -1],
      [-1, 2],
      [1, 2],
    ])
      for (const [minZ, maxZ] of [
        [-3, -2],
        [-2.5, -1.5],
        [-2, -1],
      ])
        agree(minX, minY, minZ, maxX, maxY, maxZ);
});
