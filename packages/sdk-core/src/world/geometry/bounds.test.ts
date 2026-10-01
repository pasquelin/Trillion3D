import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from './geometry.ts';
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from '../buffer/attribute.ts';
import {
  plainPoints,
  pointAt,
  readPoints,
  readsStored,
  readComponent,
  spanBox,
  spanSphere,
} from './bounds.ts';
import { Box3 } from '../math/box3.ts';
import { Sphere } from '../math/volumes.ts';
import { Vector3 } from '../math/vector3.ts';

test('position readers distinguish owned XYZ storage, normalized integers and interleaved pairs', () => {
  const plain = new BufferAttribute(new Float64Array([1, 2, 3, 4, 5, 6]), 3);
  assert.equal(plainPoints(plain), plain);
  assert.equal(readPoints(plain), plain.array);
  assert.equal(plainPoints(undefined), null);
  assert.deepEqual(readPoints(undefined), []);
  const normalized = new BufferAttribute(new Int16Array([0, 32767, -32768]), 3, true);
  assert.equal(plainPoints(normalized), null);
  assert.deepEqual(Array.from(readPoints(normalized)), [0, 1, -1]);
  const packed = new InterleavedBuffer(new Float32Array([99, 2, 3, 88, 7, 11]), 3);
  const pair = new InterleavedBufferAttribute(packed, 2, 1);
  assert.equal(plainPoints(pair), null);
  assert.deepEqual(Array.from(readPoints(pair)), [2, 3, 0, 7, 11, 0]);
  const out = [-1, -1, -1];
  assert.equal(pointAt(pair, 1, out), out);
  assert.deepEqual(out, [7, 11, 0]);
  assert.equal(readsStored({ _owner: 'world' }, normalized), true);
  assert.equal(readsStored({ _owner: 'host' }, normalized), false);
  assert.equal(readsStored({ _owner: 'world' }, pair), false);
  assert.equal(readComponent({ _owner: 'world' }, normalized, 0, 1), 32767);
  assert.equal(readComponent({ _owner: 'host' }, normalized, 0, 1), 1);
  assert.equal(readComponent({ _owner: 'world' }, pair, 1, 1), 11);
});

test('absolute and relative morph bounds enclose every posed vertex with the same physical box', () => {
  for (const relative of [false, true]) {
    const g = new Geometry().setAttribute(
      'position',
      new BufferAttribute(new Float64Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
    );
    g.morphTargetsRelative = relative;
    g.morphAttributes.position = [
      new BufferAttribute(
        new Float64Array(
          relative ? [10, 4, 6, 10, 4, 6, 10, 4, 6] : [10, 4, 6, 12, 4, 6, 10, 6, 6],
        ),
        3,
      ),
    ];
    const box = new Box3(),
      ball = new Sphere();
    assert.equal(spanBox(box, g), box);
    assert.equal(spanSphere(ball, g), ball);
    assert.deepEqual(box.min.toArray(), [0, 0, 0]);
    assert.deepEqual(box.max.toArray(), [12, 6, 6]);
    assert.deepEqual(ball.center.toArray(), [6, 3, 3]);
    assert.equal(ball.radius, Math.sqrt(54));
    const plain = g.attributes.position.array.slice();
    assert.deepEqual([...plain], [0, 0, 0, 2, 0, 0, 0, 2, 0]);
  }
});

test('bounds read normalized/interleaved coordinates and preserve a supplied sphere without positions', () => {
  const packed = new InterleavedBuffer(
    new Int16Array([99, -32768, 0, 32767, 88, 32767, 32767, 0]),
    4,
  );
  const position = new InterleavedBufferAttribute(packed, 3, 1, true);
  const g = new Geometry().setAttribute('position', position);
  const box = spanBox(new Box3(), g),
    ball = spanSphere(new Sphere(), g);
  assert.deepEqual(box.min.toArray(), [-1, 0, 0]);
  assert.deepEqual(box.max.toArray(), [1, 1, 1]);
  assert.deepEqual(ball.center.toArray(), [0, 0.5, 0.5]);
  assert.equal(ball.radius, Math.sqrt(1.5));
  const kept = new Sphere(new Vector3(2, 3, 4), 5),
    empty = new Geometry();
  assert.equal(spanSphere(kept, empty), kept);
  assert.deepEqual(kept.center.toArray(), [2, 3, 4]);
  assert.equal(kept.radius, 5);
  assert.equal(spanBox(new Box3(new Vector3(), new Vector3(1, 1, 1)), empty).isEmpty(), true);
});

test('a ball reaches the farthest point, on a plain list and on a morphed shape alike', () => {
  const g = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 6, 0, 0, 0, 8, 0]), 3),
  );
  const plain = spanSphere(new Sphere(), g);
  assert.deepEqual(plain.center.toArray(), [3, 4, 0]);
  assert.equal(plain.radius, 5);
  // A target carrying the first vertex out to (0, 0, 24) widens the box to its middle and the ball.
  g.morphAttributes.position = [
    new BufferAttribute(new Float32Array([0, 0, 24, 6, 0, 0, 0, 8, 0]), 3),
  ];
  const morphed = spanSphere(new Sphere(), g);
  assert.deepEqual(morphed.center.toArray(), [3, 4, 12]);
  assert.equal(morphed.radius, 13);
});
