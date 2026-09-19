// Common tools for tests and volume benchmarks (batch M2): Three.js Box3 built from six
// flat floats and read back flat, and bitwise comparison (Object.is distinguishes -0 from +0
// and sees NaN). Three is only used as a reference, never in a math*.ts file.
import assert from 'node:assert/strict';
import * as THREE from 'three';

/** A Three.js Box3 built from `[minX, minY, minZ, maxX, maxY, maxZ]`. */
export const boite3 = (b) =>
  new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));

/** Box3 bounds copied flat, in the order of `boite3`. */
export const aPlat = (box) =>
  Float64Array.of(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);

/** Fails on the first bitwise mismatch between two number sequences of the same length. */
export function assertBits(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(actual[i], expected[i]),
      `component ${i} : ${actual[i]} !== ${expected[i]}`,
    );
}
