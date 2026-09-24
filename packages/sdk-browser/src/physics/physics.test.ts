import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ASLEEP_BIT,
  CommandWriter,
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

test('the committed module drops a box on a floor, then sends no pose once it sleeps', async () => {
  const jolt = await instantiateJolt(await wasm(), 64, 64 * 1024 * 1024);
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add(body(0, 0, -1, 1));
  writer.add(body(1, 2, 3, 0.5));
  jolt.step(writer.take(), 0);
  let asleepAt = -1;
  for (let step = 0; step < 600 && asleepAt < 0; step++) {
    const count = jolt.step(null, 1 / 60);
    const words = jolt.poses(count);
    if (count && words[0] & ASLEEP_BIT) {
      asleepAt = step;
      const y = new Float32Array(words.buffer, words.byteOffset, POSE_WORDS)[2];
      assert.ok(Math.abs(y - 0.5) < 0.05, `rests on the floor, y = ${y}`);
    }
  }
  assert.ok(asleepAt > 0, 'the box falls asleep');
  assert.equal(jolt.step(null, 1 / 60), 0);
  assert.equal(jolt.active(), 0);
});

test('a memory budget below the module’s own memory is refused', async () => {
  await assert.rejects(instantiateJolt(await wasm(), 64, 1024 * 1024), /PHYSICS_BUDGET/);
});

test('a body past the bodies budget is refused with PHYSICS_BUDGET', () => {
  const scene = new Group();
  const host = {} as PhysicsHost;
  const bodies = createPhysicsBodies(
    new CommandWriter(),
    { bodies: 1, triangles: 0, decorative: 0, memoryBytes: 0 },
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
  new Float32Array(words.buffer).set([0, 2, 0, 0, 0, 0, 1, 0, 0, 0], 1);
  assert.equal(poses.receive(words, 1, [crate], 0), 1);
  assert.equal(poses.apply([crate]), false);
  assert.equal(crate.position.y, 2);
  assert.equal(poses.receive(words, 1, [crate], 0), 0);
  assert.equal(poses.apply([crate]), false);
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
