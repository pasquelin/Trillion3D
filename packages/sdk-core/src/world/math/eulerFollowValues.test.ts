import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler } from './euler.ts';
import { Quaternion } from './quaternion.ts';
import { Matrix4 } from './matrix4.ts';
import { listen } from './observed.ts';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test('each component getter follows a change confined to one quaternion component', () => {
  const angle = 2 * Math.atan(3 / 4);
  for (const axis of ['x', 'y', 'z'] as const) {
    const source = new Quaternion();
    source[axis] = 0.6;
    source.w = 0.8;
    const value = new Euler().setFromQuaternion(source);
    value._follow(source);
    source[axis] = -0.6;
    near(value[axis], -angle);
  }
  const source = new Quaternion(0.6, 0, 0, 0.8);
  const value = new Euler().setFromQuaternion(source);
  value._follow(source);
  source.w = -0.8;
  near(value.x, -angle);
});

test('component setters resolve pending source changes before preserving the explicit edit', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const source = new Quaternion();
    const value = new Euler();
    value._follow(source);
    source.setFromEuler(new Euler(0.2, 0.3, 0.4));
    value[axis] = 0.8;
    near(value.x, axis === 'x' ? 0.8 : 0.2);
    near(value.y, axis === 'y' ? 0.8 : 0.3);
    near(value.z, axis === 'z' ? 0.8 : 0.4);
  }
  const source = new Quaternion();
  const value = new Euler();
  value._follow(source);
  source.setFromEuler(new Euler(0.2, 0.3, 0.4));
  value.order = 'ZYX';
  assert.equal(value.order, 'ZYX');
  near(value.x, 0.2);
  near(value.y, 0.3);
  near(value.z, 0.4);
});

test('default Euler order and explicit conversion notifications remain public state', () => {
  const value = new Euler();
  assert.deepEqual(value.toArray(), [0, 0, 0, 'XYZ']);
  let changes = 0;
  listen(value, () => changes++);
  const turn = new Quaternion().setFromEuler(new Euler(0.2, 0.3, 0.4));
  value.setFromQuaternion(turn);
  assert.equal(changes, 1);
  value.setFromRotationMatrix(new Matrix4().makeRotationFromQuaternion(turn));
  assert.equal(changes, 2);
  value.setFromQuaternion(turn, 'XYZ', true);
  value.setFromRotationMatrix(new Matrix4().makeRotationFromQuaternion(turn), 'XYZ', true);
  assert.equal(changes, 2);
});

test('near-pole matrices use the stable zero-angle representative at the branch boundary', () => {
  for (const [order, middle, element, sign, zero] of [
    ['XYZ', 'y', 8, 1, 'z'],
    ['YXZ', 'x', 9, -1, 'z'],
    ['ZXY', 'x', 6, 1, 'y'],
    ['ZYX', 'y', 2, -1, 'x'],
    ['YZX', 'z', 1, 1, 'x'],
    ['XZY', 'z', 4, -1, 'y'],
  ] as const) {
    const angles = new Euler(0.2, 0.3, 0.4, order);
    angles[middle] = Math.asin(0.9999999);
    const matrix = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromEuler(angles));
    // Pin the supplied matrix entry to the representable boundary, avoiding one-ulp
    // drift from the quaternion conversion used to construct its other entries.
    matrix.elements[element] = sign * 0.9999999;
    const result = new Euler().setFromRotationMatrix(matrix, order);
    assert.equal(result[zero], 0, order);
  }
});
