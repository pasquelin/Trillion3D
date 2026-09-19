import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addScaledVector3,
  applyMatrix3Vector3,
  copyScaledVector3,
  crossVector3,
  dotVector3,
  lengthSqVector3,
  normalizeVector3,
  scaleVector3,
  transformAffinePoint,
  transformDirectionVector3,
  transformHomogeneousPoint,
} from './mathVector.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Shared hostile vectors: zero, NaN, ±0, infinities, denormal — same three components read on
 *  both sides, so any gap can only come from the algebra. */
const VECTEURS: [number, number, number][] = [
  [0, 0, 0],
  [-0, 0, -0],
  [3, -4, 12],
  [NaN, 1, -1],
  [Infinity, -Infinity, 1],
  [1e308, 1e308, -1e308],
  [5e-324, -5e-324, 1],
];
const SCALAIRES = [0, -0, 1, -1, 2.5, NaN, Infinity, -Infinity];

/** `Object.is` component by component: distinguishes -0/0 and treats NaN as equal to itself. */
function bitEqualVec3(out: ArrayLike<number>, v: THREE.Vector3, label: string) {
  assert.ok(Object.is(out[0], v.x), `${label}, x: ${out[0]} != ${v.x}`);
  assert.ok(Object.is(out[1], v.y), `${label}, y: ${out[1]} != ${v.y}`);
  assert.ok(Object.is(out[2], v.z), `${label}, z: ${out[2]} != ${v.z}`);
}

test('dotVector3: dot product of the first three components only', () => {
  assert.equal(dotVector3([1, 2, 3], [4, 5, 6]), 32);
  assert.equal(dotVector3([1, 0, 0], [0, 1, 0]), 0);
});

test('crossVector3: x × y = z, right-hand rule', () => {
  const out = crossVector3(new Float64Array(3), [1, 0, 0], [0, 1, 0]);
  assert.deepEqual([...out], [0, 0, 1]);
});

test('crossVector3: generic vectors, the three components crossed', () => {
  const out = crossVector3(new Float64Array(3), [1, 2, 3], [4, 5, 6]);
  assert.deepEqual([...out], [-3, 6, -3]);
});

test('crossVector3: the output may alias either input, six reads before write', () => {
  const a: [number, number, number] = [1, 2, 3],
    b: [number, number, number] = [4, 5, 6];
  const attendu = crossVector3(new Float64Array(3), a, b);
  const surA = Float64Array.from(a);
  crossVector3(surA, surA, b);
  assert.deepEqual([...surA], [...attendu], 'out === a');
  const surB = Float64Array.from(b);
  crossVector3(surB, a, surB);
  assert.deepEqual([...surB], [...attendu], 'out === b');
});

test('transformAffinePoint: identity leaves the point unchanged, translation alone shifts', () => {
  const identite = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
  const out = transformAffinePoint(new Float64Array(3), identite, 1, 2, 3);
  assert.deepEqual([...out], [6, 8, 10]);
});

test('transformAffinePoint: no perspective divide even on a non-affine matrix', () => {
  // Last row (2, 0, 0, 1) instead of (0, 0, 0, 1): the function ignores this row by
  // construction, so its result depends only on the first three rows.
  const m = [1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const out = transformAffinePoint(new Float64Array(3), m, 3, 4, 5);
  assert.deepEqual([...out], [3, 4, 5]);
});

test('transformHomogeneousPoint: carries the fourth component, divide left to the caller', () => {
  // Matrice de projection perspective simple : w = -z.
  const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];
  const out = transformHomogeneousPoint(new Float64Array(4), proj, 2, 4, -10);
  assert.deepEqual([...out], [2, 4, -10, 10]);
});

test('normalizeVector3: a zero vector stays zero, an ordinary vector becomes length 1', () => {
  const nul = new Float64Array([0, 0, 0]);
  normalizeVector3(nul);
  assert.deepEqual([...nul], [0, 0, 0]);
  const v = new Float64Array([3, 0, 4]);
  normalizeVector3(v);
  assert.ok(proche(Math.hypot(v[0], v[1], v[2]), 1));
  assert.ok(proche(v[0], 0.6) && v[1] === 0 && proche(v[2], 0.8));
});

test('normalizeVector3 : contre v.normalize(), NaN, ±0 et infinis compris', () => {
  for (const v of VECTEURS) {
    const out = Float64Array.from(v);
    normalizeVector3(out);
    const ref = new THREE.Vector3(...v).normalize();
    bitEqualVec3(out, ref, `normalize(${v})`);
  }
});

test('lengthSqVector3 : contre v.lengthSq(), NaN, ±0 et infinis compris', () => {
  for (const v of VECTEURS) {
    const out = lengthSqVector3(v);
    const ref = new THREE.Vector3(...v).lengthSq();
    assert.ok(Object.is(out, ref), `lengthSq(${v}): ${out} != ${ref}`);
  }
});

test('scaleVector3 : contre v.multiplyScalar(s) en place, NaN, ±0 et infinis compris', () => {
  for (const v of VECTEURS)
    for (const s of SCALAIRES) {
      const out = Float64Array.from(v);
      scaleVector3(out, s);
      const ref = new THREE.Vector3(...v).multiplyScalar(s);
      bitEqualVec3(out, ref, `scale(${v}, ${s})`);
    }
});

test('copyScaledVector3 : contre out.copy(a).multiplyScalar(s), out distinct de a', () => {
  for (const a of VECTEURS)
    for (const s of SCALAIRES) {
      const out = new Float64Array(3);
      copyScaledVector3(out, a, s);
      const ref = new THREE.Vector3().copy(new THREE.Vector3(...a)).multiplyScalar(s);
      bitEqualVec3(out, ref, `copyScaled(${a}, ${s})`);
    }
});

test('addScaledVector3 : contre out.addScaledVector(a, s), accumulation sur un out non nul', () => {
  for (const base of VECTEURS)
    for (const a of VECTEURS.slice(0, 3))
      for (const s of [1, -1, 0.5, NaN, Infinity]) {
        const out = Float64Array.from(base);
        addScaledVector3(out, a, s);
        const ref = new THREE.Vector3(...base).addScaledVector(new THREE.Vector3(...a), s);
        bitEqualVec3(out, ref, `addScaled(${base}, ${a}, ${s})`);
      }
});

/** Hostile column-major 3×3 matrices: identity, shear, negative and non-uniform scale,
 *  singular (third column a combination of the other two). */
const MATRICES_3X3: number[][] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, -1, 0, 0, 0, 1],
  [2, 0, 0, 0, -3, 0, 0, 0, 0.5],
  [1, 2, 0, 0, 1, 0, 0, 0.5, 1], // shear
  [1, 2, 3, 2, 4, 6, 3, 6, 9], // singular: collinear columns
  [NaN, 0, 0, 0, 1, 0, 0, 0, -1],
];

test('applyMatrix3Vector3: against v.applyMatrix3(m), shear and negative scale included', () => {
  for (const m of MATRICES_3X3)
    for (const v of VECTEURS) {
      const out = new Float64Array(3);
      applyMatrix3Vector3(out, m, v[0], v[1], v[2]);
      const mat3 = new THREE.Matrix3().fromArray(m);
      const ref = new THREE.Vector3(...v).applyMatrix3(mat3);
      bitEqualVec3(out, ref, `applyMatrix3(${m}, ${v})`);
    }
});

/** Hostile affine 4×4 matrices for `transformDirection`: translation (last column) is
 *  ignored, only the upper-left 3×3 block counts, shear and negative scale included. */
const MATRICES_4X4: number[][] = [
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, -9, 9, 1],
  [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  [2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 0.5, 0, 5, 6, 7, 1],
  [1, 2, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1], // shear
  [NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
];

test('transformDirectionVector3 : contre v.transformDirection(m), vecteur nul compris', () => {
  for (const m of MATRICES_4X4)
    for (const v of VECTEURS) {
      const out = new Float64Array(3);
      transformDirectionVector3(out, m, v[0], v[1], v[2]);
      const mat4 = new THREE.Matrix4().fromArray(m);
      const ref = new THREE.Vector3(...v).transformDirection(mat4);
      bitEqualVec3(out, ref, `transformDirection(${m}, ${v})`);
    }
});
