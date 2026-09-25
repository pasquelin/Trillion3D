import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandWriter,
  DEFAULT_MATTER,
  DEFAULT_PHYSICS_BUDGET,
  OP,
  ObjectPhysics,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, type Bodied } from './bodies.ts';
import { placeBodies } from './placeBodies.ts';
import { createPhysicsPoses } from './poses.ts';
import { receiveSoft } from './softBodies.ts';
import { createSoftTick } from './softTick.ts';

/** A scene whose bodies are written to `writer`, `softVertices` soft vertices allowed. */
function sceneOf(softVertices: number, host = {} as PhysicsHost) {
  const scene = new Group(),
    writer = new CommandWriter();
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 4, softVertices };
  const bodies = createPhysicsBodies(
    writer,
    budget,
    host,
    scene,
    createPhysicsPoses(4, scene).state,
  );
  const cloth = (segments: number) => {
    const mesh = new Mesh(plane(1, 1, segments, segments), new Material('meshStandard'));
    mesh.physics = { type: 'cloth' };
    scene.add(mesh);
    return mesh as Bodied;
  };
  return { scene, writer, bodies, cloth };
}

test('soft-body vertices past their budget are refused with PHYSICS_BUDGET, and freed on removal', () => {
  const { writer, bodies, cloth } = sceneOf(100);
  const small = cloth(5),
    large = cloth(10);
  const refused: { code: string }[] = [];
  bodies.reconcile(new Set(), (error) => refused.push(error as { code: string }));
  assert.equal(refused[0]?.code, 'PHYSICS_BUDGET', '121 vertices past 100');
  assert.equal(large.physics._host, null);
  assert.equal(bodies.count.softVertices, 36, 'the 6 × 6 cloth is counted');
  assert.equal(writer.take()[0], OP.soft);
  bodies.removeAt(small.physics._index);
  assert.equal(bodies.count.softVertices, 0);
});

test('a tick’s soft records reach physics.vertices, each geometry vertex from its simulated one', () => {
  const mesh = new Mesh(plane(), new Material('meshStandard'));
  mesh.physics = new ObjectPhysics({ type: 'cloth' });
  mesh.physics._index = 3;
  const bodies = {
    meshOf: (id: number) => (id === 7 ? (mesh as Bodied) : null),
    softMap: (index: number) => (index === 3 ? Uint32Array.of(1, 0, 0) : null),
  };
  const words = new Uint32Array(2 + 6 + 2 + 3);
  words.set([9, 1], 0);
  words.set([7, 2], 5);
  new Float32Array(words.buffer).set([1, 2, 3, 4, 5, 6], 7);
  assert.deepEqual(receiveSoft(words, bodies), [mesh], 'the body that left is skipped');
  assert.deepEqual([...mesh.physics.vertices!], [4, 5, 6, 1, 2, 3, 1, 2, 3]);
  assert.deepEqual(receiveSoft(null, bodies), []);
});

test('a tick keeps each soft body once, where its last step left it', () => {
  const tick = createSoftTick();
  tick.gather(Uint32Array.of(5, 1, 1, 1, 1, 6, 1, 2, 2, 2));
  tick.gather(Uint32Array.of(5, 1, 3, 3, 3));
  assert.deepEqual([...tick.take()!], [5, 1, 3, 3, 3, 6, 1, 2, 2, 2]);
  assert.equal(tick.take(), null);
});

test('a soft body the page moves is made again where it put it, never teleported', () => {
  const rebuilt: ObjectPhysics[] = [];
  const host = { rebuild: (body: ObjectPhysics) => rebuilt.push(body) } as unknown as PhysicsHost;
  const { scene, writer, bodies, cloth } = sceneOf(1000, host);
  const mesh = cloth(2);
  bodies.reconcile(new Set(), () => {});
  writer.take();
  placeBodies(scene, host, writer);
  assert.deepEqual(rebuilt, [mesh.physics]);
  assert.equal(writer.length, 0);
});

test('a soft body’s SOFT carries its own friction, restitution, pull and scale, else its material’s', () => {
  const soft = (own: boolean) => {
    const { writer, bodies, cloth } = sceneOf(100);
    const mesh = cloth(1);
    if (own) Object.assign(mesh.physics, { friction: 0.25, restitution: 0.75, gravityScale: 0.5 });
    mesh.scale.set(2, 3, 4);
    bodies.reconcile(new Set(), () => assert.fail('refused'));
    return [...new Float32Array(writer.take().buffer).subarray(10, 16)];
  };
  assert.deepEqual(soft(true), [2, 3, 4, 0.25, 0.75, 0.5]);
  assert.deepEqual(soft(false).slice(3), [DEFAULT_MATTER.friction, DEFAULT_MATTER.restitution, 1]);
});
