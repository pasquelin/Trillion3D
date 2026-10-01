import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute } from '../buffer/attribute.ts';
import { Geometry } from './geometry.ts';
import { drawnTriangles } from './drawn.ts';

test('imported indexed line quads retain normalized endpoint RGBA and skip zero-length segments', () => {
  const geometry = new Geometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0]), 3))
    .setAttribute(
      'color',
      new BufferAttribute(new Uint8Array([255, 0, 0, 128, 0, 255, 0, 255]), 4, true),
    )
    .setIndex([0, 0, 1, 0]);
  geometry._owner = 'host';
  const drawn = drawnTriangles(geometry, 'lineSegments')!;
  assert.deepEqual(Array.from(drawn.positions), [2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(drawn.colors!), [
    0,
    1,
    0,
    1,
    0,
    1,
    0,
    1,
    1,
    0,
    0,
    Math.fround(128 / 255),
    1,
    0,
    0,
    Math.fround(128 / 255),
  ]);
});

test('wireframe and closed lines preserve RGB colours with opaque alpha', () => {
  const geometry = new Geometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3))
    .setAttribute('color', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3));
  for (const primitive of ['triangles', 'lineLoop'] as const) {
    const drawn = drawnTriangles(geometry, primitive, { wireframe: true })!;
    assert.equal(drawn.positions.length / 3, 12);
    for (let vertex = 0; vertex < 12; vertex++) {
      const [x, y] = drawn.positions.subarray(vertex * 3, vertex * 3 + 2);
      const expected = x === 2 ? [0, 1, 0, 1] : y === 2 ? [0, 0, 1, 1] : [1, 0, 0, 1];
      assert.deepEqual(Array.from(drawn.colors!.subarray(vertex * 4, vertex * 4 + 4)), expected);
    }
  }
});
