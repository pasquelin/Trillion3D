import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandWriter,
  DAMPING,
  DEFAULT_MATTER,
  DEFAULT_PHYSICS_BUDGET,
  FLAG,
  OP,
  ObjectPhysics,
  SOFT_VERTEX_WORDS,
  SOFT_WORDS,
  type PhysicsHost,
  type SoftBodyOptions,
} from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, type Bodied } from './bodies.ts';
import { placeBodies } from './placeBodies.ts';
import { createSessionHost } from './sessionHost.ts';
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
  const cloth = (segments: number, options: Partial<SoftBodyOptions> = {}) => {
    const mesh = new Mesh(plane(1, 1, segments, segments), new Material('meshStandard'));
    mesh.physics = { type: 'cloth', ...options } as SoftBodyOptions;
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

/** The SOFT words `obj.physics = options` writes for a 1 × 1 cloth scaled 2, 3, 4, as floats. */
function softWords(options: Partial<SoftBodyOptions>, then = (_: Bodied) => {}) {
  const { writer, bodies, cloth } = sceneOf(100);
  const mesh = cloth(1, options);
  mesh.scale.set(2, 3, 4);
  then(mesh);
  bodies.reconcile(new Set(), (e) => assert.fail(String(e)));
  return new Float32Array(writer.take().buffer);
}

test('obj.physics gives a soft body its friction, restitution, pull and damping, else defaults', () => {
  const own = { friction: 0.25, restitution: 0.75, gravityScale: 0.5, damping: { linear: 0.625 } };
  // Scale, then friction, restitution, gravity scale, linear damping (softLayout.ts).
  assert.deepEqual([...softWords(own).subarray(9, 16)], [2, 3, 4, 0.25, 0.75, 0.5, 0.625]);
  assert.deepEqual(
    [...softWords({}).subarray(12, 16)],
    [DEFAULT_MATTER.friction, DEFAULT_MATTER.restitution, 1, Math.fround(DAMPING)],
  );
});

test('obj.physics gives a soft body its stretch, bend, pressure, pins and mass, set or written', () => {
  const words = softWords({ type: 'volume', stretch: 0.25, bend: 0.5, pressure: 0.5, pins: [0] });
  assert.deepEqual([...words.subarray(16, 19)], [0.25, 0.5, 0.5], 'stretch, bend, pressure');
  // The cloth's four vertices, `x, y, z, mass` each, follow the fixed words.
  const mass = (w: Float32Array) =>
    w.subarray(SOFT_WORDS, SOFT_WORDS + 4 * SOFT_VERTEX_WORDS).filter((_, i) => i % 4 === 3);
  assert.equal(mass(words)[0], 0, 'the pin weighs nothing');
  const sum = (w: Float32Array) => mass(w).reduce((a, b) => a + b);
  assert.ok(Math.abs(sum(softWords({ mass: 2 })) - 2) < 1e-6, 'given');
  assert.ok(Math.abs(sum(softWords({ mass: 2 }, (m) => (m.physics.mass = 3))) - 3) < 1e-6, 'set');
});

test('a soft body with a contact handler asks for its events when made, and as handlers come and go', () => {
  let session: PhysicsHost | null = null;
  const host = { listened: (body: ObjectPhysics) => session!.listened(body) } as PhysicsHost;
  const { writer, bodies, cloth } = sceneOf(100, host);
  session = createSessionHost(
    writer,
    () => bodies.meshes,
    () => {},
    () => {},
  );
  const mesh = cloth(1);
  const stop = mesh.physics.on('enter', () => {});
  bodies.reconcile(new Set(), (e) => assert.fail(String(e)));
  const made = writer.take(),
    flags = SOFT_WORDS + 4 * SOFT_VERTEX_WORDS + 6;
  assert.equal(made[0], OP.soft);
  assert.deepEqual([...made.subarray(flags)], [OP.flags, 0, FLAG.events], 'made, then listened to');
  stop();
  assert.deepEqual([...writer.take()], [OP.flags, 0, 0], 'no handler left, no events');
});
