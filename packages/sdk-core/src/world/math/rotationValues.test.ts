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

test('quaternion storage, inverse, normalization and shortest arcs preserve physical rotations', () => {
  const value = new Quaternion();
  let changes = 0;
  listen(value, () => changes++);
  assert.equal(value.set(1, 2, 3, 4), value);
  assert.equal(changes, 1);
  value.set(1, 2, 3, 4);
  assert.equal(changes, 1);
  value.set(2, 2, 3, 4, true);
  assert.equal(changes, 1);
  value.w = 5;
  assert.equal(changes, 2);
  value.fromArray([91, 1, 2, 3, 4, 92], 1);
  assert.deepEqual(value.toArray(), [1, 2, 3, 4]);
  const copy = value.clone();
  assert.notEqual(copy.elements, value.elements);
  assert.equal(value.dot(new Quaternion(2, 3, 4, 5)), 40);
  assert.equal(new Quaternion(1, 2, 2, 4).length(), 5);
  close(new Quaternion(1, 2, 2, 4).normalize().toArray(), [0.2, 0.4, 0.4, 0.8]);
  assert.deepEqual(value.clone().invert().toArray(), [-1, -2, -3, 4]);
  assert.deepEqual(value.clone().conjugate().toArray(), [-1, -2, -3, 4]);
  assert.ok(value.clone().equals(value));
  for (const change of [
    [2, 2, 3, 4],
    [1, 3, 3, 4],
    [1, 2, 4, 4],
    [1, 2, 3, 5],
  ])
    assert.equal(new Quaternion(...change).equals(value), false);
  const halfTurn = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 3 }, Math.PI);
  const halfway = new Quaternion().slerp(halfTurn, 0.5);
  close(new Vector3(1, 0, 0).applyQuaternion(halfway).toArray(), [0, 1, 0]);
  assert.ok(Math.abs(new Quaternion().angleTo(halfway) - Math.PI / 2) < 1e-10);
  close(
    halfway
      .clone()
      .slerp(halfway.clone().set(-halfway.x, -halfway.y, -halfway.z, -halfway.w), 0.25)
      .toArray(),
    halfway.toArray(),
  );
  assert.deepEqual(value.identity().toArray(), [0, 0, 0, 1]);
});

test('unit-vector rotations handle opposite axes and composition matches matrix order', () => {
  for (const [from, to] of [
    [
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [-1, 0, 0],
    ],
    [
      [0, 0, 1],
      [0, 0, -1],
    ],
    [
      [0, 1, 0],
      [0, -1, 0],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
    ],
  ]) {
    const a = new Vector3(...from),
      b = new Vector3(...to);
    close(a.clone().applyQuaternion(new Quaternion().setFromUnitVectors(a, b)).toArray(), to);
  }
  const a = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3), 0.7);
  const b = new Quaternion().setFromAxisAngle(new Vector3(-2, 4, 1), -0.9);
  const expected = new Matrix4()
    .makeRotationFromQuaternion(a)
    .multiply(new Matrix4().makeRotationFromQuaternion(b));
  for (const q of [
    a.clone().multiply(b),
    b.clone().premultiply(a),
    new Quaternion().multiplyQuaternions(a, b),
  ])
    close(new Matrix4().makeRotationFromQuaternion(q).toArray(), expected.toArray());
  close(
    new Matrix4()
      .makeRotationFromQuaternion(new Quaternion().setFromRotationMatrix(expected))
      .toArray(),
    expected.toArray(),
  );
});
