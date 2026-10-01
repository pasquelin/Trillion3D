import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from './quaternion.ts';
import { Vector3 } from './vector3.ts';
import { Matrix4 } from './matrix4.ts';
import { listen } from './observed.ts';
import { near as within } from '../../math/near.fixture.ts';

const close = (a: number[], b: number[]) => within(a, b, 'rotation', 1e-7);

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

test('a write of any one number is a write, heard; a turn from angles is heard too', () => {
  for (let k = 0; k < 4; k++) {
    const value = new Quaternion(1, 2, 3, 4);
    let heard = 0;
    listen(value, () => heard++);
    const next = [1, 2, 3, 4];
    next[k] = 9;
    value.set(next[0], next[1], next[2], next[3]);
    assert.deepEqual(value.toArray(), next);
    assert.equal(heard, 1);
  }
  const turned = new Quaternion();
  let heard = 0;
  listen(turned, () => heard++);
  turned.setFromEuler({ x: 0.1, y: 0.2, z: 0.3, order: 'XYZ' });
  assert.equal(heard, 1);
});

test('a rotation read from a matrix is that matrix, whatever was computed before it', () => {
  new Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
  const m = new Matrix4().makeRotationAxis({ x: 0, y: 0, z: 1 }, 1);
  close(
    new Quaternion().setFromRotationMatrix(m).toArray(),
    new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, 1).toArray(),
  );
});

test('the shortest turn between oblique unit vectors, and a half-turn onto their opposites', () => {
  const a = new Vector3(0.6, 0.8, 0),
    b = new Vector3(0, 0.6, 0.8);
  // Unit vectors with no zero coordinate, so every term of the turn counts.
  const p = new Vector3(0.48, 0.6, 0.64),
    q = new Vector3(0.6, 0.64, 0.48);
  close(
    p.clone().applyQuaternion(new Quaternion().setFromUnitVectors(p, q)).toArray(),
    q.toArray(),
  );
  for (const from of [a, b, new Vector3(0, 0.8, 0.6)]) {
    const to = from.clone().negate();
    close(
      from.clone().applyQuaternion(new Quaternion().setFromUnitVectors(from, to)).toArray(),
      to.toArray(),
    );
  }
});
