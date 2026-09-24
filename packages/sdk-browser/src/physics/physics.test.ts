import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  ASLEEP_BIT,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  ObjectPhysics,
  POSE_WORDS,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, type Bodied } from './bodies.ts';
import { instantiateJolt } from './joltModule.ts';
import type { JoltThreadStart } from './joltThreads.ts';
import { createPhysicsPoses } from './poses.ts';
import { createWorldPhysics } from './worldPhysics.ts';

const wasm = () => readFile(new URL('./joltPhysics.wasm', import.meta.url));
const body = (index: number, motion: number, y: number, half: number) => ({
  index,
  motion,
  layer: motion === 0 ? 0 : 1,
  shape: 0 as const,
  flags: 0,
  position: [0, y, 0],
  quaternion: [0, 0, 0, 1],
  size: [half, half, half] as const,
  mass: 0,
  density: 600,
  friction: 0.5,
  restitution: 0,
  gravityScale: 1,
});

/** Drops a box on a floor, `seen` or behind the view; returns the step at which it sleeps. */
async function dropBox(jolt: Awaited<ReturnType<typeof instantiateJolt>>, seen: boolean) {
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
  const jolt = await instantiateJolt(await wasm(), 64, 64 * 1024 * 1024, null);
  assert.ok((await dropBox(jolt, true)) > 0, 'the box falls asleep');
});

test('the threaded module steps on its pool, and a body asleep out of view says so', async () => {
  const bytes = await readFile(new URL('./joltPhysicsThreads.wasm', import.meta.url));
  const threads: NodeWorker[] = [];
  const loader = new URL('./joltThreads.ts', import.meta.url).href;
  const spawn = (start: JoltThreadStart) =>
    threads.push(
      new NodeWorker(
        `import(${JSON.stringify(loader)}).then((m) => m.runJoltThread(require('node:worker_threads').workerData))`,
        { eval: true, workerData: start },
      ),
    );
  const jolt = await instantiateJolt(bytes, 64, 64 * 1024 * 1024, { count: 3, spawn });
  try {
    assert.equal(threads.length, 2, 'two pool threads beside the stepping one');
    assert.ok((await dropBox(jolt, false)) > 0, 'the asleep record comes, out of view');
  } finally {
    await Promise.all(threads.map((thread) => thread.terminate()));
  }
});

test('a memory budget below the module’s own memory is refused', async () => {
  await assert.rejects(instantiateJolt(await wasm(), 64, 1024 * 1024, null), /PHYSICS_BUDGET/);
});

test('a body past the bodies budget is refused with PHYSICS_BUDGET', () => {
  const scene = new Group();
  const host = {} as PhysicsHost;
  const bodies = createPhysicsBodies(
    new CommandWriter(),
    { bodies: 1, triangles: 0, decorative: 0, memoryBytes: 0, threads: 1 },
    host,
    scene,
  );
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

test('a pose sent again unchanged moves nothing and asks for no frame', () => {
  const poses = createPhysicsPoses(4);
  const crate = new Mesh(box()) as Bodied;
  crate.physics = new ObjectPhysics('dynamic');
  const words = new Uint32Array(POSE_WORDS);
  new Float32Array(words.buffer).set([0, 2, 0, 0, 0, 0, 1], 1);
  assert.equal(
    poses.receive(words, 1, [crate], 0, () => {}),
    1,
  );
  assert.equal(poses.apply([crate]), false);
  assert.equal(crate.position.y, 2);
  assert.equal(
    poses.receive(words, 1, [crate], 0, () => {}),
    0,
  );
  assert.equal(poses.apply([crate]), false);
});

test('a pose drawn by the batch leaves position, quaternion and angles coherent', () => {
  const poses = createPhysicsPoses(4);
  const crate = new Mesh(box()) as Bodied;
  crate.physics = new ObjectPhysics('dynamic');
  const words = new Uint32Array(POSE_WORDS);
  const half = Math.SQRT1_2;
  new Float32Array(words.buffer).set([1, 2, 3, 0, half, 0, half], 1);
  poses.receive(words, 1, [crate], 0, () => {});
  poses.apply([crate]);
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [1, 2, 3]);
  assert.ok(
    Math.abs(crate.rotation.y - Math.PI / 2) < 1e-3,
    `turned a quarter, ${crate.rotation.y}`,
  );
  crate.updateWorldMatrix(true, false);
  assert.ok(Math.abs(crate.matrixWorld.elements[13] - 2) < 1e-6, 'the tree holds the pose');
});

test('a decorative body asleep is placed, taken out, and never added again', () => {
  const scene = new Group();
  const bodies = createPhysicsBodies(
    new CommandWriter(),
    DEFAULT_PHYSICS_BUDGET,
    {} as PhysicsHost,
    scene,
  );
  const mesh = new Mesh(box(), new Material('meshStandard'));
  mesh.physics = { decorative: true };
  const chip = mesh as Bodied;
  scene.add(chip);
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)));
  const poses = createPhysicsPoses(4);
  const words = new Uint32Array(POSE_WORDS);
  words[0] = chip.physics._index | ASLEEP_BIT;
  new Float32Array(words.buffer).set([0, 0.5, 0, 0, 0, 0, 1], 1);
  poses.receive(words, 1, bodies.meshes, 16, bodies.retire);
  assert.equal(chip.position.y, 0.5);
  assert.equal(bodies.count.decorative, 0);
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)));
  assert.equal(bodies.count.bodies, 0);
});

test('a world without physics starts no worker; enabling it starts one', () => {
  const started: unknown[] = [];
  const saved = globalThis.Worker;
  globalThis.Worker = class {
    constructor(url: URL) {
      started.push(url);
    }
    postMessage() {}
    terminate() {}
  } as unknown as typeof Worker;
  try {
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, new Group(), () => new Camera('perspective'));
    assert.equal(physics.frame(), false);
    assert.equal(started.length, 0);
    physics.handle.enabled = true;
    assert.equal(started.length, 1);
    physics.dispose();
  } finally {
    globalThis.Worker = saved;
  }
});
