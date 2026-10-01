import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../world/geometry/basic.ts';
import { SHAPE } from './layout.ts';
import type { PhysicsShape } from './options.ts';
import { resolveShape } from './shape.ts';
import { ball, refusedShape as refused, twice } from './shape.fixture.ts';

test('a compound places its primitives in the body, scaled', () => {
  const raft = resolveShape(box(), twice, 'dynamic', {
    type: 'compound',
    parts: [
      { type: 'box', halfExtents: [1, 0.1, 1], position: [0, 0.5, 0] },
      { type: 'cylinder', halfHeight: 1, radius: 0.2, quaternion: [0, 0, 0.6, 0.8] },
      { type: 'sphere', radius: 2, position: [3, 4, 5] },
    ],
  });
  assert.equal(raft.shape, SHAPE.compound);
  assert.deepEqual(raft.size, [0, 0, 0]);
  assert.equal(raft.triangles, 0);
  assert.deepEqual(raft.parts, [
    { shape: SHAPE.box, size: [2, 0.2, 2], position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    { shape: SHAPE.cylinder, size: [2, 0.4, 0], position: [0, 0, 0], quaternion: [0, 0, 0.6, 0.8] },
    { shape: SHAPE.sphere, size: [4, 0, 0], position: [6, 8, 10], quaternion: [0, 0, 0, 1] },
  ]);
});

test('a compound stretched, flattened or mirrored is refused naming its scale and the mesh', () => {
  const shape: PhysicsShape = { type: 'compound', parts: [ball] };
  const made = (s: { x: number; y: number; z: number }, name?: string) => () =>
    resolveShape(box(), s, 'dynamic', shape, name);
  for (const [x, y, z, mirrored] of [
    [0, 0, 0, false],
    [-1, 1, 0, false],
    [1, 2.5, 1, false],
    [1, 1, 2.5, false],
    [-1, -1, 1, false],
    [-1, 0, 1, false],
    [-1, -1, -1, true],
    [-1, 1, 1, true],
    [1, -1, 1, true],
    [1, 1, -1, true],
  ] as const) {
    const message = refused(made({ x, y, z }, 'raft'), 'raft');
    assert.ok(message.includes(`${x}, ${y}, ${z}`), message);
    assert.equal(/mirror/.test(message), mirrored, message);
    assert.equal(message.endsWith(`${x}, ${y}, ${z}.`), !mirrored, 'the scale said last');
  }
  // Below the tolerance a scale is uniform, never below 0.
  for (const axis of ['x', 'y', 'z'] as const)
    for (const value of [0, -1e-8]) refused(made({ x: 1e-8, y: 1e-8, z: 1e-8, [axis]: value }), '');
  assert.equal(
    refused(made({ x: 1, y: 2, z: 1 }), ''),
    refused(made({ x: 1, y: 2, z: 1 }, ''), ''),
  );
});
