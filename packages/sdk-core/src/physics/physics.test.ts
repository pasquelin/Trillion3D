import test from 'node:test';
import assert from 'node:assert/strict';
import { box, plane, sphere } from '../world/geometry/basic.ts';
import { capsule } from '../world/geometry/round.ts';
import { Material } from '../world/material/material.ts';
import { CommandWriter } from './commands.ts';
import { JOLT_COMMIT, readCookedPhysics } from './cooked.ts';
import { ADD_WORDS, OP, SHAPE, VIEW_WORDS } from './layout.ts';
import { physicsMatterOf } from './matter.ts';
import { resolveShape } from './shape.ts';

const one = { x: 1, y: 1, z: 1 };

test('ADD carries its fixed words at their layout offsets, then the mesh', () => {
  const writer = new CommandWriter();
  writer.add({
    id: 7,
    motion: 2,
    layer: 1,
    shape: SHAPE.triangles,
    flags: 4,
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    size: [0.5, 0.25, 0.125],
    mass: 80,
    density: 600,
    friction: 0.25,
    restitution: 0.75,
    gravityScale: 0.5,
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  });
  const words = writer.take();
  const floats = new Float32Array(words.buffer);
  assert.equal(words.length, ADD_WORDS + 9 + 3);
  assert.deepEqual([...words.subarray(0, 6)], [OP.add, 7, 2, 1, SHAPE.triangles, 4]);
  assert.deepEqual([...floats.subarray(6, 9)], [1, 2, 3]);
  assert.deepEqual([...floats.subarray(13, 21)], [0.5, 0.25, 0.125, 80, 600, 0.25, 0.75, 0.5]);
  assert.deepEqual([words[21], words[22]], [3, 3]);
  assert.deepEqual([...words.subarray(ADD_WORDS + 9)], [0, 1, 2]);
  assert.equal(writer.length, 0);
});

test('VIEW carries the eye, the facing, the cone and the range', () => {
  const writer = new CommandWriter();
  writer.view([1, 2, 3], [0, 0, -1], 0.5, 400);
  const words = writer.take();
  assert.equal(words.length, VIEW_WORDS);
  assert.equal(words[0], OP.view);
  assert.deepEqual([...new Float32Array(words.buffer).subarray(1)], [1, 2, 3, 0, 0, -1, 0.5, 400]);
});

test('the shape is the exact primitive a geometry was built as, scaled', () => {
  assert.deepEqual(resolveShape(box(2, 4, 6), { x: 2, y: 1, z: 1 }, 'dynamic').size, [2, 2, 3]);
  assert.equal(resolveShape(sphere(0.5), { x: 2, y: 2, z: 2 }, 'dynamic').size[0], 1);
  const pill = resolveShape(capsule(0.3, 1), one, 'dynamic');
  assert.equal(pill.shape, SHAPE.capsule);
  assert.deepEqual(pill.size, [0.5, 0.3, 0]);
});

test('a compound places its primitives in the body, scaled; a stretched one is refused', () => {
  const raft = resolveShape(box(), { x: 2, y: 2, z: 2 }, 'dynamic', {
    type: 'compound',
    parts: [
      { type: 'box', halfExtents: [1, 0.1, 1], position: [0, 0.5, 0] },
      { type: 'cylinder', halfHeight: 1, radius: 0.2, quaternion: [0, 0, 0.6, 0.8] },
    ],
  });
  assert.equal(raft.shape, SHAPE.compound);
  assert.deepEqual(raft.parts, [
    { shape: SHAPE.box, size: [2, 0.2, 2], position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    { shape: SHAPE.cylinder, size: [2, 0.4, 0], position: [0, 0, 0], quaternion: [0, 0, 0.6, 0.8] },
  ]);
  const stretched = { x: 1, y: 2, z: 1 };
  assert.throws(() => resolveShape(box(), stretched, 'dynamic', { type: 'compound', parts: [] }), {
    code: 'PHYSICS_FAILED',
  });
});

test('any other mesh is triangles when static and a hull when it moves', () => {
  const ground = resolveShape(plane(4, 4, 2, 2), one, 'static');
  assert.equal(ground.shape, SHAPE.triangles);
  assert.equal(ground.triangles, 8);
  const squashed = resolveShape(sphere(1, 8, 6), { x: 1, y: 0.5, z: 1 }, 'dynamic');
  assert.equal(squashed.shape, SHAPE.hull);
  assert.equal(squashed.triangles, 0);
});

test('a material preset gives the matter, and the material’s own fields win over it', () => {
  assert.deepEqual(physicsMatterOf(new Material('meshStandard')), {
    density: 1000,
    friction: 0.5,
    restitution: 0,
  });
  const rubber = new Material('meshStandard', { physics: 'rubber', friction: 0.2 });
  assert.deepEqual(physicsMatterOf(rubber), { density: 1100, friction: 0.2, restitution: 0.8 });
});

test('a dynamic body declared as triangles is refused: triangles hold no mass', () => {
  assert.throws(() => resolveShape(box(), { x: 1, y: 1, z: 1 }, 'dynamic', { type: 'triangles' }), {
    code: 'PHYSICS_FAILED',
  });
});

test('physics.json of another format, or cooked by another Jolt, is refused by name', () => {
  const file = { formatVersion: 1, jolt: JOLT_COMMIT, colliders: [], instances: [] };
  assert.equal(readCookedPhysics(file).colliders.length, 0);
  for (const wrong of [
    { ...file, formatVersion: 2 },
    { ...file, jolt: '0'.repeat(40) },
  ])
    assert.throws(() => readCookedPhysics(wrong), { code: 'PHYSICS_FORMAT' });
});
