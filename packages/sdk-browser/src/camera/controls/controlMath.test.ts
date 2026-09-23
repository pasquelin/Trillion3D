import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dollyDistance,
  moveLocal,
  orbitOrientation,
  panOffset,
  pixelWorldScale,
} from './controlMath.ts';
import {
  clampNumber,
  fromSpherical,
  RADIUS_EPSILON,
  toSpherical,
} from '../../../../sdk-core/src/world/math/spherical.ts';
import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  rotateByQuaternion,
  localTurnQuaternion,
} from '../../../../sdk-core/src/math/matrix/quaternion.ts';

const close = (actual: ArrayLike<number>, expected: number[], epsilon = 1e-12) => {
  for (let i = 0; i < expected.length; i++)
    assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `${i}: ${actual[i]} != ${expected[i]}`);
};

test('spherical and cartesian describe the same offset, both ways', () => {
  const spherical = new Float64Array(3),
    offset = new Float64Array(3);
  for (const source of [
    [0, 0, 7],
    [3, 4, 5],
    [-2, -9, 0.5],
    [0, 6, 0],
  ]) {
    toSpherical(spherical, source);
    assert.equal(spherical[0], Math.hypot(...source));
    close(fromSpherical(offset, spherical), source, 1e-12);
  }
});

test('an offset shorter than the epsilon keeps the angles it cannot define', () => {
  const spherical = Float64Array.from([5, 1.25, 0.75]);
  toSpherical(spherical, [0, 0, 0]);
  close(spherical, [0, 1.25, 0.75]);
});

test('the orbit orientation looks from its offset back at the pivot', () => {
  const spherical = new Float64Array(3),
    orientation = new Float64Array(4),
    offset = new Float64Array(3),
    forward = new Float64Array(3);
  for (const source of [
    [0, 0, 4],
    [4, 0, 0],
    [1, 3, -2],
  ]) {
    toSpherical(spherical, source);
    orbitOrientation(orientation, spherical);
    rotateByQuaternion(forward, orientation, 0, 0, -1);
    fromSpherical(offset, spherical);
    const radius = spherical[0];
    close(forward, [-offset[0] / radius, -offset[1] / radius, -offset[2] / radius], 1e-12);
  }
});

test('the orbit orientation keeps the horizon level: no roll on the camera right axis', () => {
  const orientation = new Float64Array(4),
    right = new Float64Array(3);
  orbitOrientation(orientation, [3, 0.9, 1.2]);
  rotateByQuaternion(right, orientation, 1, 0, 0);
  close(right, [Math.cos(0.9), 0, -Math.sin(0.9)], 1e-12);
});

test('a quaternion product is the two rotations in order, and stays unit length', () => {
  const a = axisAngleQuaternion(new Float64Array(4), [0, 1, 0], Math.PI / 2),
    b = axisAngleQuaternion(new Float64Array(4), [1, 0, 0], Math.PI / 2);
  const product = normalizeQuaternion(multiplyQuaternion(new Float64Array(4), a, b));
  // Pitched a quarter turn up, then yawed a quarter turn: the view ends on world up.
  const turned = rotateByQuaternion(new Float64Array(3), product, 0, 0, -1);
  close(turned, [0, 1, 0], 1e-15);
  assert.equal(Math.hypot(...product).toFixed(15), '1.000000000000000');
});

test('a local turn pitches, yaws and rolls in the camera frame', () => {
  const turn = localTurnQuaternion(new Float64Array(4), Math.PI / 2, 0, 0);
  close(rotateByQuaternion(new Float64Array(3), turn, 0, 0, -1), [0, 1, 0], 1e-15);
  const rolled = localTurnQuaternion(new Float64Array(4), 0, 0, Math.PI / 2);
  close(rotateByQuaternion(new Float64Array(3), rolled, 1, 0, 0), [0, 1, 0], 1e-15);
});

test('a move along the camera axes follows what it faces', () => {
  const position = new Float64Array(3),
    quarter = axisAngleQuaternion(new Float64Array(4), [0, 1, 0], Math.PI / 2);
  moveLocal(position, [0, 0, 0, 1], 0, 0, 2);
  close(position, [0, 0, -2], 1e-15);
  moveLocal(position, quarter, 0, 0, 3);
  close(position, [-3, 0, -2], 1e-15);
  moveLocal(position, [0, 0, 0, 1], 0, 0, 0);
  close(position, [-3, 0, -2], 1e-15);
});

test('a pan pushes the camera against the drag, scaled by the distance it looks across', () => {
  const scale = pixelWorldScale(10, 90, 400);
  assert.ok(Math.abs(scale - 20 / 400) < 1e-12);
  const offset = panOffset(new Float64Array(3), [0, 0, 0, 1], 8, 4, scale);
  close(offset, [-8 * scale, 4 * scale, 0], 1e-15);
});

test('a wheel notch is five percent of the distance, and the clamp bounds it', () => {
  assert.ok(Math.abs(dollyDistance(10, 1, 1) - 9.5) < 1e-12);
  assert.ok(Math.abs(dollyDistance(10, -1, 1) - 10 / 0.95) < 1e-12);
  assert.equal(dollyDistance(10, 0, 1), 10);
  assert.equal(clampNumber(0.5, 1, 4), 1);
  assert.equal(clampNumber(9, 1, 4), 4);
  assert.equal(clampNumber(2, 1, 4), 2);
  assert.ok(RADIUS_EPSILON > 0);
});
