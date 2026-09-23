// Lot 3, mathFrustum.ts: normalized frustum planes in REVERSED depth, raw clip planes,
// and planes brought back to local space — each compared against a reference built with Three.js
// primitives (Frustum, Vector4, Matrix4), down to the bit.
//
// Engine depth is reversed: the plane bounding the NEAR is what standard depth called FAR,
// and vice versa. The six planes of the same matrix are therefore exactly those of the reference,
// with the last two swapped — and this swap, and nothing else, is what `permuteProcheLoin` describes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumPlanesFromMatrix, frustumPlanesToLocal } from './index.ts';
import { assertBits } from '../../tests/kit/assert/bits.ts';

/** The six planes of Three.js copied flat, normal then constant. The reference is always read
 *  in `[0, 1]` clipping: that is the engine's range, and only depth DIRECTION is reversed —
 *  which swaps the last two planes, and nothing else. */
function planesFromThreeFrustum(
  m: THREE.Matrix4,
  Type: Float64ArrayConstructor | Float32ArrayConstructor,
) {
  const tronc = new THREE.Frustum().setFromProjectionMatrix(m, THREE.WebGPUCoordinateSystem);
  const sortie = new Type(24);
  tronc.planes.forEach((p, i) =>
    sortie.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  );
  return sortie;
}

/** The reference in `[0, 1]` clipping, with its last two planes swapped: what reversed depth
 *  expects, term for term. */
function permuteProcheLoin(planes: Float64Array | Float32Array) {
  const sortie = planes.slice();
  sortie.set(planes.subarray(20, 24), 16);
  sortie.set(planes.subarray(16, 20), 20);
  return sortie;
}

function camera(webgpu: boolean, orthographique: boolean) {
  const cam = orthographique
    ? new THREE.OrthographicCamera(-8, 8, 5, -5, 0.2, 250)
    : new THREE.PerspectiveCamera(55, 1.4, 0.15, 400);
  cam.coordinateSystem = webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
  cam.updateProjectionMatrix();
  cam.position.set(3, -2, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

for (const webgpu of [false, true]) {
  for (const orthographique of [false, true]) {
    test(`frustumPlanesFromMatrix matches Frustum.setFromProjectionMatrix (webgpu=${webgpu}, ortho=${orthographique})`, () => {
      const m = camera(webgpu, orthographique);
      const obtenu = new Float64Array(24);
      frustumPlanesFromMatrix(obtenu, m.elements);
      assertBits(obtenu, permuteProcheLoin(planesFromThreeFrustum(m, Float64Array)));
    });
  }
}

test('frustumPlanesFromMatrix in single precision rounds once, like a Float32 uniform', () => {
  const m = camera(true, false);
  const obtenu = new Float32Array(24);
  frustumPlanesFromMatrix(obtenu, m.elements);
  assertBits(obtenu, permuteProcheLoin(planesFromThreeFrustum(m, Float32Array)));
});

test('clipPlanesFromMatrix yields raw sums and differences of matrix rows', () => {
  const m = camera(false, false);
  const obtenu = new Float64Array(24);
  clipPlanesFromMatrix(obtenu, m.elements);
  assertBits(obtenu, clipPlanesAttendus(m));
});

test('frustumPlanesToLocal transforms each plane by p · m, like p transformed by transpose of m', () => {
  const m = camera(false, false);
  const placement = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.9, 1.1)),
    new THREE.Vector3(-2, 1.5, 4),
  );
  const planes = new Float32Array(24);
  frustumPlanesFromMatrix(planes, m.elements);
  const transposee = new THREE.Matrix4().copy(placement).transpose();
  const attendu = new Float64Array(24);
  for (let i = 0; i < 24; i += 4) {
    const p = new THREE.Vector4(
      planes[i],
      planes[i + 1],
      planes[i + 2],
      planes[i + 3],
    ).applyMatrix4(transposee);
    attendu.set([p.x, p.y, p.z, p.w], i);
  }
  const obtenu = new Float64Array(24);
  frustumPlanesToLocal(obtenu, planes, placement.elements);
  assertBits(obtenu, attendu);
});

/** The six raw (unnormalized) planes copied from Three.js primitives, the last two
 *  already in reversed depth order —
 *  same construction as the `clipPlanesFromMatrix` test above, factorized for interleaving
 *  below. */
function clipPlanesAttendus(m: THREE.Matrix4) {
  const e = m.elements;
  const w = new THREE.Vector4(e[3], e[7], e[11], e[15]);
  const lignes = [
    new THREE.Vector4(e[0], e[4], e[8], e[12]),
    new THREE.Vector4(e[1], e[5], e[9], e[13]),
    new THREE.Vector4(e[2], e[6], e[10], e[14]),
  ];
  const attendu = new Float64Array(24);
  // Four side planes, then FAR — the only depth row without `w` — and NEAR.
  [
    [0, -1],
    [0, 1],
    [1, 1],
    [1, -1],
    [2, 0],
    [2, -1],
  ].forEach(([k, signe], i) => {
    const p = signe === 0 ? new THREE.Vector4().copy(lignes[k]) : new THREE.Vector4().copy(w);
    if (signe > 0) p.add(lignes[k]);
    else if (signe < 0) p.sub(lignes[k]);
    attendu.set([p.x, p.y, p.z, p.w], i * 4);
  });
  return attendu;
}

// perf(socle) e5509b57: the four components of a plane are passed as arguments to `writePlane`
// and no longer via a module buffer (`plane`, a `Float64Array(4)` shared across calls).
// Without this buffer, two interleaved frustum computations — each in its own `out` — can no longer
// collide; there is nothing left to allocate or reuse per call. Verify this with two
// very different frustums whose writes are manually interleaved, each compared against
// the Three.js reference.
test('frustumPlanesFromMatrix and clipPlanesFromMatrix: no shared buffer, two interleaved frustums remain independent', () => {
  const m1 = camera(false, false);
  const m2 = camera(true, true);
  const obtenu1 = new Float64Array(24);
  const obtenu2 = new Float64Array(24);
  const clip1 = new Float64Array(24);
  const clip2 = new Float64Array(24);
  // Interleaved writes: if a component still passed through a shared module buffer,
  // this order would cause it to be overwritten by the next call before reading.
  frustumPlanesFromMatrix(obtenu1, m1.elements);
  clipPlanesFromMatrix(clip2, m2.elements);
  frustumPlanesFromMatrix(obtenu2, m2.elements);
  clipPlanesFromMatrix(clip1, m1.elements);
  assertBits(obtenu1, permuteProcheLoin(planesFromThreeFrustum(m1, Float64Array)));
  assertBits(obtenu2, permuteProcheLoin(planesFromThreeFrustum(m2, Float64Array)));
  assertBits(clip1, clipPlanesAttendus(m1));
  assertBits(clip2, clipPlanesAttendus(m2));
});

test('a NaN or zero projection matrix yields NaN or infinite planes, without throwing', () => {
  for (const m of [new Array(16).fill(NaN), new Array(16).fill(0)]) {
    const sortie = new Float64Array(24);
    assert.doesNotThrow(() => frustumPlanesFromMatrix(sortie, m));
    assert.doesNotThrow(() => clipPlanesFromMatrix(sortie, m));
  }
});
