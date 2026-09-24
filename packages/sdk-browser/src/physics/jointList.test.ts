import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  GENERATION_SHIFT,
  JOINT_WORDS,
  OP,
  POSE_WORDS,
  joint,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createWorldPhysics } from './worldPhysics.ts';
import { fakeWorkers, loaded } from './worker.fixture.ts';

test('world.physics.add sends the joint once its body is simulated; a break reply breaks it', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const door = new Mesh(box(1, 2, 0.1), new Material('meshStandard'));
    const hinge = joint.hinge(door, null, { anchor: [0.5, 0, 0], breakForce: 10 });
    physics.handle.add(hinge);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    assert.equal(hinge._id, -1, 'no body yet: no joint');
    door.physics = 'dynamic';
    scene.add(door);
    physics.frame();
    const sent = worker.words.at(-1)!;
    const at = sent.indexOf(OP.joint);
    assert.ok(at >= 0 && sent.length >= at + JOINT_WORDS, 'the joint follows its body');
    assert.equal(sent[at + 1], hinge._id);
    let told = false;
    hinge.on('break', () => (told = true));
    worker.onmessage({ data: { type: 'broken', joints: [hinge._id] } });
    assert.ok(hinge.broken && told, 'broken, and told');
    assert.equal(hinge._id, -1, 'out of the simulation');
    physics.handle.remove(hinge);
    physics.dispose();
  } finally {
    restore();
  }
});

test('a decorative body retired asleep takes its joints out on the page, as a removed body does', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const debris = new Mesh(box(), new Material('meshStandard'));
    debris.physics = { type: 'dynamic', decorative: true };
    scene.add(debris);
    const pin = joint.fixed(debris, null);
    physics.handle.add(pin);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    assert.ok(pin._id >= 0, 'made with its body');
    // The first body of a session: slot 0, generation 1; asleep, at the origin.
    const words = new Uint32Array(POSE_WORDS);
    words[0] = debris.physics._index | (1 << GENERATION_SHIFT) | ASLEEP_BIT;
    new Float32Array(words.buffer).set([0, 0, 0, 0, 0, 0, 1], 1);
    const tick = { poses: 1, events: 0, dropped: 0, steps: 1, seconds: 1 / 60, stepMs: 0 };
    const results = { type: 'results', buffer: words.buffer, active: 0, character: null };
    worker.onmessage({ data: { ...tick, ...results } });
    assert.equal(debris.physics._index, -1, 'retired');
    const id = pin._id;
    physics.frame();
    assert.equal(pin._id, -1, 'the joint left with its body');
    assert.equal(pin._host, null, 'no write reaches a dead joint');
    const sent = worker.words.at(-1)!;
    assert.equal(sent[sent.indexOf(OP.unjoint) + 1], id);
    physics.dispose();
  } finally {
    restore();
  }
});

test('a distance joint given only limits.min keeps a maximum no shorter than it', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const bob = new Mesh(box(), new Material('meshStandard'));
    bob.physics = 'dynamic';
    scene.add(bob);
    // Two metres from its anchor, held at three at least.
    physics.handle.add(joint.distance(bob, null, { anchorB: [0, 2, 0], limits: { min: 3 } }));
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    const sent = worker.words.at(-1)!;
    const at = sent.indexOf(OP.joint),
      floats = new Float32Array(sent.buffer, sent.byteOffset, sent.length);
    // After the op, the id, the kind and ends, and the two frames: minimum, then maximum.
    const [min, max] = [floats[at + 23], floats[at + 24]];
    assert.equal(min, 3);
    assert.ok(max >= min, `max ${max} below min ${min}`);
    physics.dispose();
  } finally {
    restore();
  }
});
