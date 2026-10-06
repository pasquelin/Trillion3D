// Batch M2, sphere.ts: bounding sphere of a box, checked bit-exact against the host library's
// bounding sphere of a box (Object.is), empty box included.
import test from 'node:test';
import * as THREE from 'three';
import {
  boxTransform,
  sphereFromBounds,
} from '../../../../../../../packages/sdk-core/src/index.ts';
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts';
import { aPlat, box3 } from '../../../../../../oracles/core/volumes.ts';

const witnessSphere = (b: ArrayLike<number>) => {
  const s = box3(b).getBoundingSphere(new THREE.Sphere());
  return Float64Array.of(s.center.x, s.center.y, s.center.z, s.radius);
};

/** The engine's sphere of a flat box. */
const sphereOf = (b: ArrayLike<number>) => {
  const actual = new Float64Array(4);
  sphereFromBounds(actual, 0, b[0], b[1], b[2], b[3], b[4], b[5]);
  return actual;
};

test('sphereFromBounds matches the host-library bounding sphere for ordinary, point and extreme boxes', () => {
  const boxes = [
    [-1, -2, -3, 4, 5, 6],
    [2, 3, 4, 2, 3, 4], // point box: zero radius
    [-1e308, -1e308, -1e308, 1e308, 1e308, 1e308],
    [-0, -0, -0, 0, 0, 0],
  ];
  for (const b of boxes) assertBits(sphereOf(b), witnessSphere(b));
});

test('an empty box (inverted bounds) yields the empty sphere: zero centre, radius -1', () => {
  const inverted = [1, 1, 1, -1, -1, -1];
  const actual = sphereOf(inverted);
  assertBits(actual, witnessSphere(inverted));
  assertBits(actual, Float64Array.of(0, 0, 0, -1));
});

test('sphereFromBounds after boxTransform matches the host-library transformed box then bounding sphere', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 1.4, 0.2));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(3, -2, 1),
    q,
    new THREE.Vector3(0.5, 4, -2),
  );
  const b = [-2, -1, -3, 1, 2, 4];
  const expected = witnessSphere(aPlat(box3(b).applyMatrix4(m)));
  const transformed = new Float64Array(6);
  boxTransform(transformed, 0, b, 0, m.elements);
  assertBits(sphereOf(transformed), expected);
});
