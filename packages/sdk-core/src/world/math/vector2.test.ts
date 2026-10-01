import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, Vector4, Spherical } from './vector2.ts';
import { listen, unlisten } from './observed.ts';

test('planar vector arithmetic preserves both coordinates and notifies its owners', () => {
  const value = new Vector2(3, 4);
  const heard: string[] = [];
  const first = () => heard.push('first'),
    second = () => heard.push('second');
  listen(value, first);
  listen(value, second);
  listen(value, first);
  value.x = 6;
  value.y = 8;
  assert.deepEqual(heard, ['first', 'second', 'first', 'second']);
  assert.equal(value.length(), 10);
  assert.equal(value.normalize(), value);
  assert.ok(Math.abs(value.x - 0.6) < 1e-14);
  assert.ok(Math.abs(value.y - 0.8) < 1e-14);
  value.set(3, 4).add({ x: 2, y: -7 }).sub({ x: -1, y: -2 }).multiplyScalar(3);
  assert.deepEqual(value.toArray(), [18, -3]);
  assert.equal(value.distanceTo({ x: 15, y: 1 }), 5);
  assert.equal(value.fromArray([99, 7, -8, 55], 1), value);
  assert.deepEqual(value.toArray(), [7, -8]);
  const copy = value.clone();
  assert.notEqual(copy, value);
  copy.copy({ x: 2, y: 3 });
  assert.deepEqual(copy.toArray(), [2, 3]);
  assert.deepEqual(value.toArray(), [7, -8]);
  unlisten(value, first);
  heard.length = 0;
  value.set(1, 2);
  assert.deepEqual(heard, ['second']);
  unlisten(value, second);
  heard.length = 0;
  value.y = 5;
  assert.deepEqual(heard, []);
  assert.deepEqual(new Vector2().normalize().toArray(), [0, 0]);
});

test('four-dimensional vectors retain all components through copy and clone', () => {
  const value = new Vector4(1, 2, 3, 4);
  assert.deepEqual(value.toArray(), [1, 2, 3, 4]);
  assert.equal(value.set(5, 6, 7, 8), value);
  const clone = value.clone();
  assert.notEqual(clone, value);
  assert.deepEqual(clone.toArray(), [5, 6, 7, 8]);
  assert.equal(clone.copy({ x: 9, y: 10, z: 11, w: 12 }), clone);
  assert.deepEqual(clone.toArray(), [9, 10, 11, 12]);
  assert.deepEqual(value.toArray(), [5, 6, 7, 8]);
});

test('spherical value objects use polar-from-up angles and reset the zero vector', () => {
  const value = new Spherical(2, 0.3, 0.7);
  const clone = value.clone();
  assert.notEqual(clone, value);
  assert.deepEqual([clone.radius, clone.phi, clone.theta], [2, 0.3, 0.7]);
  assert.equal(value.set(3, 0.4, 0.8), value);
  assert.deepEqual([value.radius, value.phi, value.theta], [3, 0.4, 0.8]);
  value.setFromVector3({ x: -2, y: 0, z: 0 });
  assert.deepEqual([value.radius, value.phi, value.theta], [2, Math.PI / 2, -Math.PI / 2]);
  value.setFromVector3({ x: 0, y: 0, z: 0 });
  assert.deepEqual([value.radius, value.phi, value.theta], [0, 0, 0]);
});
