import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  POSE_WORDS,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies } from './bodies.ts';
import { createPhysicsPoses } from './poses.ts';
import { createWorldPhysics } from './worldPhysics.ts';
import { body, startModule, startThreaded, type Module } from './module.fixture.ts';
/** The session's code, fetched on the first use (`worldPhysics.ts`), has been loaded. */
const loaded = () => import('./session.ts').then(() => new Promise((done) => setTimeout(done, 0)));
/** Drops a box on a floor, `seen` or behind the view; returns the step at which it sleeps. */
async function dropBox(jolt: Module, seen: boolean) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  if (!seen) writer.view([0, 3, 10], [0, 0, 1], 0.5, 100);
  writer.add(body(0, 0, -1, 1));
  writer.add(body(1, 2, 3, 0.5));
  jolt.step(writer.take(), 0);
  for (let step = 0; step < 600; step++) {
    const count = jolt.step(null, 1 / 60);
    const words = jolt.poses(count);
    assert.ok(seen || count === 0 || words[0] & ASLEEP_BIT, 'a body out of view sends no pose');
    if (count && words[0] & ASLEEP_BIT) {
      const y = new Float32Array(words.buffer, words.byteOffset, POSE_WORDS)[2];
      assert.ok(Math.abs(y - 0.5) < 0.05, `rests on the floor, y = ${y}`);
      assert.equal(jolt.step(null, 1 / 60), 0);
      assert.equal(jolt.active(), 0);
      return step;
    }
  }
  return -1;
}

test('the committed module drops a box on a floor, then sends no pose once it sleeps', async () => {
  const jolt = await startModule();
  assert.ok((await dropBox(jolt, true)) > 0, 'the box falls asleep');
});

test('the threaded module steps on its pool, and a body asleep out of view says so', async () => {
  const { jolt, threads, close } = await startThreaded(3);
  try {
    assert.equal(threads.length, 2, 'two pool threads beside the stepping one');
    assert.ok((await dropBox(jolt, false)) > 0, 'the asleep record comes, out of view');
  } finally {
    await close();
  }
});

test('a memory budget below the module’s own memory is refused', async () => {
  await assert.rejects(startModule({ memoryBytes: 1024 * 1024 }), { code: 'PHYSICS_BUDGET' });
});

test('a body past the bodies budget is refused with PHYSICS_BUDGET', () => {
  const scene = new Group();
  const host = {} as PhysicsHost;
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 1 };
  const state = createPhysicsPoses(1, scene).state;
  const bodies = createPhysicsBodies(new CommandWriter(), budget, host, scene, state);
  const crates = [0, 1].map(() => {
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.physics = 'dynamic';
    scene.add(crate);
    return crate;
  });
  const refused: unknown[] = [];
  bodies.reconcile(new Set(), (error) => refused.push(error));
  assert.equal(bodies.count.bodies, 1);
  assert.equal((refused[0] as { code: string }).code, 'PHYSICS_BUDGET');
  assert.ok(crates.some((crate) => crate.physics?._host === host));
});

test('a world without physics starts no worker; enabling it starts one', async () => {
  const started: unknown[] = [];
  const saved = globalThis.Worker;
  globalThis.Worker = class {
    constructor(url: URL) {
      started.push(url);
    }
    postMessage(message: { type: string }) {
      if (message.type === 'clock') clocks.push(message);
    }
    terminate() {}
  } as unknown as typeof Worker;
  const clocks: unknown[] = [];
  try {
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, new Group(), () => new Camera('perspective'));
    assert.equal(physics.frame(), false);
    assert.equal(started.length, 0);
    physics.handle.enabled = true;
    await loaded();
    assert.equal(started.length, 1);
    // A time scale of 0 stands still: the worker is paused, never scheduled infinitely far.
    physics.handle.timeScale = 0;
    assert.deepEqual(clocks.at(-1), { type: 'clock', paused: true, timeScale: 0 });
    assert.throws(() => (physics.handle.timeScale = -1), RangeError);
    physics.dispose();
  } finally {
    globalThis.Worker = saved;
  }
});

test('a fatal worker error ends the session: physics off, the error kept, nothing more sent', async () => {
  const workers: { onmessage(event: { data: unknown }): void; sent: number; ended: boolean }[] = [];
  const saved = globalThis.Worker,
    log = console.error;
  globalThis.Worker = class {
    sent = 0;
    ended = false;
    onmessage = (_: { data: unknown }) => {};
    constructor() {
      workers.push(this);
    }
    postMessage() {
      this.sent++;
    }
    terminate() {
      this.ended = true;
    }
  } as unknown as typeof Worker;
  console.error = () => {};
  try {
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, new Group(), () => new Camera('perspective'), true);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    const fatal = { type: 'error', code: 'PHYSICS_BUDGET', message: 'out of memory', fatal: true };
    worker.onmessage({ data: fatal });
    assert.equal(physics.handle.enabled, false);
    assert.equal(physics.handle.error?.code, 'PHYSICS_BUDGET');
    assert.ok(worker.ended, 'the worker is terminated');
    const sent = worker.sent;
    physics.handle.gravity = 'moon';
    assert.equal(physics.frame(), false);
    assert.equal(worker.sent, sent, 'no command reaches the failed worker');
  } finally {
    globalThis.Worker = saved;
    console.error = log;
  }
});

test('a budget raised while the physics runs waits for the next session', async () => {
  const saved = globalThis.Worker,
    log = console.error;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {}
  } as unknown as typeof Worker;
  console.error = () => {};
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), {
      budget: { bodies: 1 },
    });
    await loaded();
    physics.budget.bodies = 4;
    for (let i = 0; i < 2; i++) {
      const crate = new Mesh(box(), new Material('meshStandard'));
      crate.physics = 'dynamic';
      scene.add(crate);
    }
    physics.frame();
    assert.equal(physics.handle.stats.bodies, 1, 'the session keeps the budget it started with');
    assert.equal(physics.handle.error?.code, 'PHYSICS_BUDGET');
    physics.dispose();
  } finally {
    globalThis.Worker = saved;
    console.error = log;
  }
});
