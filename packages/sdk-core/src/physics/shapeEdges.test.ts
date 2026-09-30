import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../world/geometry/geometry.ts';
import { primitive, resolveShape } from './shape.ts';

const sphere = { type: 'sphere', radius: 1 } as const;

test('uniform-scale tolerance is relative for large shapes and absolute for tiny ones', () => {
  assert.ok(primitive(sphere, { x: 4, y: 4, z: 4.000002 }));
  assert.equal(primitive(sphere, { x: 4, y: 4, z: 4.00002 }), null);
  assert.ok(primitive(sphere, { x: 0, y: 0, z: 0.000001 }));
  assert.equal(primitive(sphere, { x: 0, y: 0, z: 0.000002 }), null);
});

test('compound scale refusals distinguish collapsed, mirrored and ordinary distortion', () => {
  const shape = { type: 'compound', parts: [sphere] } as const;
  for (const [x, y, z, mirrored] of [
    [0, 0, 0, false],
    [-1, 1, 0, false],
    [-1, 0, 1, false],
    [-1, -1, -1, true],
    [-1, 1, 1, true],
    [1, -1, 1, true],
    [1, 1, -1, true],
    [1, 2, 1, false],
  ] as const) {
    assert.throws(
      () => resolveShape(new Geometry(), { x, y, z }, 'dynamic', shape),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(', a mirror'), mirrored);
        assert.ok(error.message.includes('same positive scale'));
        return true;
      },
    );
  }
});

test('unnamed shape refusals identify an empty name instead of an invented body', () => {
  assert.throws(
    () => resolveShape(new Geometry(), { x: 1, y: 1, z: 1 }, 'dynamic', { type: 'triangles' }),
    /body "" cannot be triangles/,
  );
  assert.throws(
    () =>
      resolveShape(new Geometry(), { x: 1, y: 2, z: 1 }, 'dynamic', {
        type: 'compound',
        parts: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.endsWith('has 1, 2, 1.'));
      return true;
    },
  );
});

test('tiny compounds still require every scale component to be strictly positive', () => {
  const shape = { type: 'compound', parts: [sphere] } as const;
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const value of [0, -1e-8]) {
      const scale = { x: 1e-8, y: 1e-8, z: 1e-8, [axis]: value };
      assert.throws(() => resolveShape(new Geometry(), scale, 'dynamic', shape), /positive scale/);
    }
  }
});
