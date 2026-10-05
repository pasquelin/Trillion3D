import { createBodySlots } from './bodySlots.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHYSICS_STEP,
  CommandWriter,
  DEFAULT_MATTER,
  DEFAULT_PHYSICS_BUDGET,
  FLAG,
  OP,
  ObjectPhysics,
  SOFT_VERTEX_WORDS,
  type PhysicsHost,
  type SoftBodyOptions,
} from '../../../sdk-core/src/physics/index.ts';
import { SOFT_DAMPING } from '../../../sdk-core/src/physics/soft.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, type Bodied } from './bodies.ts';
import { createSessionHost } from './sessionHost.ts';
import { createPhysicsPoses } from './poses.ts';
import { createSoftVertices } from './softBodies.ts';
import { createSoftTick } from './recordTick.ts';
import { SOFT_WORDS } from '../../../sdk-core/src/physics/wire.fixture.ts';

/** A scene whose bodies are written to `writer`, `softVertices` soft vertices allowed. */
function sceneOf(softVertices: number, host = {} as PhysicsHost) {
  const scene = new Group(),
    writer = new CommandWriter();
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 4, softVertices };
  const state = createPhysicsPoses(4, scene).state;
  const bodies = createPhysicsBodies(writer, budget, host, scene, state, PHYSICS_STEP);
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
  const refused: { code: string; details: object }[] = [];
  bodies.reconcile(new Set(), (error) => refused.push(error as (typeof refused)[number]));
  assert.equal(refused[0]?.code, 'PHYSICS_BUDGET', '121 vertices past 100');
  assert.deepEqual(refused[0].details, { budget: 'softVertices', limit: 100, requested: 157 });
  assert.equal(large.physics._host, null);
  assert.equal(bodies.count.softVertices, 36, 'the 6 × 6 cloth is counted');
  assert.equal(writer.take()[0], OP.soft);
  bodies.removeAt(small.physics._index);
  assert.equal(bodies.count.softVertices, 0);
});

/** A cloth in slot 3 under engine id 7, its three geometry vertices mapped to simulated vertices
 *  1, 0, 0; the soft vertices drawn of its records (`createSoftVertices`). */
function drawnCloth() {
  const mesh = new Mesh(plane(), new Material('meshStandard'));
  const physics = new ObjectPhysics({ type: 'cloth' });
  physics._index = 3;
  mesh.physics = physics;
  const bodies = {
    slots: createBodySlots(10),
    meshOf: (id: number) => (id === 7 ? (mesh as Bodied) : null),
    softMap: (index: number) => (index === 3 ? Uint32Array.of(1, 0, 0) : null),
  };
  return { physics, soft: createSoftVertices(bodies, 10) };
}

/** Records of body 9 (one vertex, gone) and body 7 (two vertices at `places`). */
function softRecords(places: number[]) {
  const words = new Uint32Array(2 + 3 + 2 + 6);
  words.set([9, 1], 0);
  words.set([7, 2], 5);
  new Float32Array(words.buffer).set(places, 7);
  return words;
}

test('a tick’s soft records reach physics.vertices, each geometry vertex from its simulated one', () => {
  const { physics, soft } = drawnCloth();
  const words = softRecords([1, 2, 3, 4, 5, 6]);
  assert.equal(soft.receive({ words, befores: null }, 1), 1, 'the body that left is skipped');
  assert.equal(soft.apply(1, false), false, 'drawn on its newest state');
  assert.deepEqual([...physics.vertices!], [4, 5, 6, 1, 2, 3, 1, 2, 3]);
  assert.equal(soft.receive(null, 1), 0);
});

test('a soft body is drawn at the bodies’ time, between its states of the two steps that bracket it', () => {
  const { physics, soft } = drawnCloth();
  soft.receive({ words: softRecords([0, 0, 0, 2, 0, 0]), befores: null }, 1);
  soft.receive({ words: softRecords([0, 4, 0, 4, 0, 0]), befores: null }, 1);
  // Half a step on: half way from its record of the step before to its newest.
  assert.equal(soft.apply(0.5, false), true, 'on its way');
  assert.deepEqual([...physics.vertices!], [3, 0, 0, 0, 2, 0, 0, 2, 0]);
  // A tick of two steps brings its record of the step before: drawn from there, not from the last.
  const befores = softRecords([0, 8, 0, 6, 0, 0]);
  soft.receive({ words: softRecords([0, 12, 0, 8, 0, 0]), befores }, 2);
  soft.apply(0.25, true);
  assert.deepEqual([...physics.vertices!], [6.5, 0, 0, 0, 9, 0, 0, 9, 0]);
  // Late, it is moved on along that step; on time again, landed on its newest.
  soft.apply(1.5, true);
  assert.deepEqual([...physics.vertices!].slice(0, 2), [9, 0]);
  assert.equal(soft.apply(1, false), false);
  assert.deepEqual([...physics.vertices!].slice(0, 2), [8, 0]);
});

test('a second soft body in the geometry another draws itself into is refused by name', () => {
  const { bodies, cloth } = sceneOf(100);
  const [left, right] = [cloth(2), cloth(2)];
  [left.name, right.name, right.geometry] = ['left', 'right', left.geometry];
  const refused: { code: string; details: object }[] = [];
  bodies.reconcile(new Set(), (error) => refused.push(error as (typeof refused)[number]));
  const named = refused.map(({ code, details }) => [code, details]);
  assert.deepEqual(named, [['PHYSICS_FAILED', { name: 'right', shares: 'left' }]]);
  right.geometry = left.geometry.clone();
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)));
  assert.equal(bodies.count.bodies, 2, 'its own geometry, it is made');
});

test('a tick keeps each soft body once, where its last step left it, and a step before', () => {
  const tick = createSoftTick();
  tick.gather(Uint32Array.of(5, 1, 1, 1, 1, 6, 1, 2, 2, 2), true);
  tick.gather(Uint32Array.of(5, 1, 3, 3, 3), true);
  // A run of no step that left it as it was keeps its step before.
  tick.gather(Uint32Array.of(5, 1, 3, 3, 3), false);
  const { words, befores } = tick.take()!;
  assert.deepEqual([...words], [5, 1, 3, 3, 3, 6, 1, 2, 2, 2]);
  assert.deepEqual([...befores!.subarray(0, 6)], [5, 1, 1, 1, 1, ~6 >>> 0], 'met once: no body');
  assert.equal(tick.take(), null);
  // One that moved it in place leaves no step to draw it over; none written twice, none sent.
  tick.gather(Uint32Array.of(5, 1, 1, 1, 1), true);
  tick.gather(Uint32Array.of(5, 1, 4, 4, 4), false);
  assert.deepEqual([...tick.take()!.befores!], [5, 1, 4, 4, 4]);
  tick.gather(Uint32Array.of(5, 1, 1, 1, 1), true);
  assert.equal(tick.take()!.befores, null);
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
  // Scale, then friction, restitution, gravity scale, linear damping (softCommands.ts).
  assert.deepEqual([...softWords(own).subarray(9, 16)], [2, 3, 4, 0.25, 0.75, 0.5, 0.625]);
  // Left out, any soft body loses a hundredth of its speed a step; declared, even none, its own.
  assert.deepEqual(
    [...softWords({}).subarray(12, 16)],
    [DEFAULT_MATTER.friction, DEFAULT_MATTER.restitution, 1, Math.fround(SOFT_DAMPING)],
  );
  assert.equal(softWords({ damping: { linear: 0 } })[15], 0, 'none declared, none kept');
  assert.equal(softWords({ type: 'volume' })[15], Math.fround(SOFT_DAMPING), 'a volume alike');
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
