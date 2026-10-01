import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from './quaternion.ts';
import { Euler } from './euler.ts';
import { Vector3 } from './vector3.ts';
import { Matrix4 } from './matrix4.ts';
import { listen } from './observed.ts';

const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-7, `${a} != ${b}`));

test('Euler conversion retains rotations for every order, including positive and negative poles', () => {
  for (const order of ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']) {
    for (const angles of [
      [0.3, -0.4, 0.7],
      [-0.6, 0.2, -0.5],
      [Math.PI / 2, 0.3, 0.7],
      [-Math.PI / 2, 0.3, 0.7],
      [0.3, Math.PI / 2, 0.7],
      [0.3, -Math.PI / 2, 0.7],
      [0.3, 0.7, Math.PI / 2],
      [0.3, 0.7, -Math.PI / 2],
    ]) {
      const original = new Euler(angles[0], angles[1], angles[2], order);
      const q = new Quaternion().setFromEuler(original);
      const recovered = new Euler().setFromQuaternion(q, order);
      const matrix = new Matrix4().makeRotationFromQuaternion(q);
      const fromMatrix = new Euler().setFromRotationMatrix(matrix, order);
      for (const result of [recovered, fromMatrix]) {
        assert.equal(result.order, order);
        const roundTrip = new Matrix4().makeRotationFromQuaternion(
          new Quaternion().setFromEuler(result),
        );
        close(roundTrip.toArray(), matrix.toArray());
      }
    }
  }
});

test('Euler owners receive explicit writes while lazy quaternion reads stay quiet', () => {
  const value = new Euler(1, 2, 3, 'YXZ');
  let changes = 0;
  listen(value, () => changes++);
  value.x = 4;
  value.y = 5;
  value.z = 6;
  value.order = 'ZXY';
  assert.deepEqual(value.toArray(), [4, 5, 6, 'ZXY']);
  assert.equal(changes, 4);
  value.set(0.1, 0.2, 0.3, 'XYZ', true);
  assert.equal(changes, 4);
  const clone = value.clone();
  value.copy(new Euler(0.4, 0.5, 0.6, 'ZYX'));
  assert.deepEqual(clone.toArray(), [0.1, 0.2, 0.3, 'XYZ']);
  assert.deepEqual(value.toArray(), [0.4, 0.5, 0.6, 'ZYX']);
  const source = new Quaternion().setFromEuler(value);
  value._follow(source);
  source.setFromEuler(new Euler(0.2, 0.3, 0.4, 'ZYX'));
  const before = changes;
  close(value.toArray().slice(0, 3) as number[], [0.2, 0.3, 0.4]);
  assert.equal(changes, before);
  value.set(0.7, 0.8, 0.9, 'ZYX');
  close(value.toArray().slice(0, 3) as number[], [0.7, 0.8, 0.9]);
});

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

test('explicit conversions notify, silent ones do not', () => {
  const value = new Euler();
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
