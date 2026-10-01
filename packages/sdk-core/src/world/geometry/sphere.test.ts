import test from 'node:test';
import assert from 'node:assert/strict';
import { sphereArrays, turnPoint } from './sphere.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('whole turns place cardinal axes exactly even before and after the first turn', () => {
  for (const offset of [-2, -1, 0, 1, 2]) {
    assert.deepEqual(turnPoint(offset), [1, 0]);
    assert.deepEqual(turnPoint(offset + 0.25), [0, 1]);
    assert.deepEqual(turnPoint(offset + 0.5), [-1, 0]);
    assert.deepEqual(turnPoint(offset + 0.75), [0, -1]);
  }
  near(turnPoint(1 / 8)[0], Math.SQRT1_2);
  near(turnPoint(1 / 8)[1], Math.SQRT1_2);
  near(turnPoint(0.25, Math.PI / 2, Math.PI)[0], -Math.SQRT1_2);
  near(turnPoint(0.25, Math.PI / 2, Math.PI)[1], Math.SQRT1_2);
  near(turnPoint(0.5, 0, Math.PI)[0], 0);
  near(turnPoint(0.5, 0, Math.PI)[1], 1);
});

test('offset sphere has exact poles and equator, unique nondegenerate outward faces and seam UVs', () => {
  const s = sphereArrays([2, -3, 5], 4, 4, 2);
  assert.deepEqual(
    s.positions,
    [
      2, 1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5, 6, -3, 5, 2, -3, 9, -2, -3, 5, 2, -3, 1, 6, -3,
      5, 2, -7, 5, 2, -7, 5, 2, -7, 5, 2, -7, 5, 2, -7, 5,
    ],
  );
  assert.deepEqual(
    s.normals,
    [
      0, 1, 0, 0, 1, 0, -0, 1, 0, 0, 1, -0, 0, 1, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, -1, 1, 0, 0,
      0, -1, 0, 0, -1, 0, -0, -1, 0, 0, -1, -0, 0, -1, 0,
    ],
  );
  assert.deepEqual(
    s.uv,
    [
      0, 1, 0.25, 1, 0.5, 1, 0.75, 1, 1, 1, 0, 0.5, 0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 1, 0.5, 0, 0,
      0.25, 0, 0.5, 0, 0.75, 0, 1, 0,
    ],
  );
  assert.deepEqual(
    s.indices,
    [0, 6, 5, 1, 7, 6, 2, 8, 7, 3, 9, 8, 5, 6, 11, 6, 7, 12, 7, 8, 13, 8, 9, 14],
  );
  assert.deepEqual(sphereArrays([2, -3, 5], 4, 4.8, 2.9), s);
  const defaultSphere = sphereArrays([1, 2, 3], 2);
  for (let i = 0; i < defaultSphere.positions.length; i += 3) {
    near(
      Math.hypot(
        defaultSphere.positions[i] - 1,
        defaultSphere.positions[i + 1] - 2,
        defaultSphere.positions[i + 2] - 3,
      ),
      2,
    );
    near(Math.hypot(...defaultSphere.normals.slice(i, i + 3)), 1);
  }
});

test('a full arc starting away from zero rotates its first point by that offset', () => {
  const [x, y] = turnPoint(0, Math.PI / 2);
  assert.ok(Math.abs(x) < 1e-8);
  assert.equal(y, 1);
});
