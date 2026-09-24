import test from 'node:test';
import assert from 'node:assert/strict';
import { JOINT_WORDS, OP, joint } from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createWorldPhysics } from './worldPhysics.ts';

/** The session's code, fetched on the first use (`worldPhysics.ts`), has been loaded. */
const loaded = () => import('./session.ts').then(() => new Promise((done) => setTimeout(done, 0)));

test('world.physics.add sends the joint once its body is simulated; a break reply breaks it', async () => {
  const workers: { onmessage(event: { data: unknown }): void; words: Uint32Array[] }[] = [];
  const saved = globalThis.Worker;
  globalThis.Worker = class {
    words: Uint32Array[] = [];
    onmessage = (_: { data: unknown }) => {};
    constructor() {
      workers.push(this);
    }
    postMessage(message: { type: string; words?: Uint32Array }) {
      if (message.words) this.words.push(message.words);
    }
    terminate() {}
  } as unknown as typeof Worker;
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
    globalThis.Worker = saved;
  }
});
