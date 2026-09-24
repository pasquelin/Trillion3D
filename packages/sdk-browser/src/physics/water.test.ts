import test from 'node:test';
import assert from 'node:assert/strict';
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import {
  CommandWriter,
  OP,
  SHAPE,
  WATER_PIECE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { startModule, startThreaded } from './module.fixture.ts';
import { cube, floater, floatingScene, raft, runWater } from './water.fixture.ts';
import { createWorldPhysics } from './worldPhysics.ts';
import { fakeWorkers, loaded } from './worker.fixture.ts';

const CALM: WaterSpec = { waves: [], level: 0 };
const CHOP: WaterSpec = {
  waves: [{ direction: [1, 0], wavelength: 4, amplitude: 0.2, steepness: 0.5 }],
  level: 0,
};

/** One body, alone, in `water` for `steps` steps: its last pose words (y at 2, vy at 9). */
async function alone(body: ReturnType<typeof floater>, water: WaterSpec, steps: number) {
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add(body);
  const { last } = runWater(await startModule(), water, writer.take(), steps);
  const pose = new Float32Array(new Uint32Array(last.get(0)!).buffer);
  return { y: pose[2], vy: pose[9] };
}

test('a body above the water falls as without water', async () => {
  const high = floater(0, [0, 20, 0], 600, cube(0.5));
  const dry = await alone(high, { ...CALM, level: -100 }, 30);
  assert.deepEqual(await alone(high, CALM, 30), dry);
});

test('a wooden cube rests at the draft its density gives, a lighter ball rises from it', async () => {
  // 600 kg/m³: 0.6 m of a 1 m cube under water, its centre 0.1 m below the surface.
  const wood = await alone(floater(0, [0, -0.1, 0], 600, cube(0.5)), CALM, 30);
  assert.ok(Math.abs(wood.y + 0.1) < 0.002 && Math.abs(wood.vy) < 0.01, `wood at ${wood.y}`);
  assert.ok(
    (await alone(floater(0, [0, -0.2, 0], 600, cube(0.5)), CALM, 5)).vy > 0,
    'deeper rises',
  );
  const cork = { shape: SHAPE.sphere, size: [0.5, 0, 0] as const };
  const ball = await alone(floater(0, [0, -0.1, 0], 250, cork), CALM, 5);
  assert.ok(ball.vy > 0, 'a lighter body rises from the same draft');
});

test('a fully immersed wooden cube rises, a steel one sinks', async () => {
  const wood = await alone(floater(0, [0, -3, 0], 600, cube(0.5)), CALM, 10);
  assert.ok(wood.vy > 0, 'wood rises');
  const steel = await alone(floater(0, [0, -3, 0], 7800, cube(0.5)), CALM, 60);
  assert.ok(steel.vy < -1 && steel.y < -3.5, 'steel sinks');
});

test('a compound floats by its pieces, a long plank is cut in slices, a cube is whole', async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.add(floater(0, [0, 0, 0], 600, raft()));
  writer.add(floater(1, [20, 0, 0], 600, { shape: SHAPE.box, size: [5, 0.2, 0.5] }));
  writer.add(floater(2, [40, 0, 0], 600, cube(0.5)));
  jolt.step(writer.take(), 0);
  const words = new Uint32Array(jolt.water(1, 2).slice().buffer);
  const pieces = Array.from({ length: words.length / WATER_PIECE_WORDS }, (_, i) => [
    words[i * WATER_PIECE_WORDS] & 0xffffff,
    words[i * WATER_PIECE_WORDS + 1] >>> 16,
  ]);
  assert.deepEqual(pieces, [
    [0, 3],
    [0, 3],
    [0, 3],
    [1, 4],
    [1, 4],
    [1, 4],
    [1, 4],
    [2, 1],
  ]);
  const { last } = runWater(await startModule(), CHOP, floatingScene(10), 600);
  const deck = new Float32Array(new Uint32Array(last.get(8)!).buffer);
  assert.ok(Math.abs(deck[2]) < 0.5, `the raft floats, at ${deck[2]}`);
});

test('trajectories are bit-identical on one thread and on eight', async () => {
  const scene = floatingScene(100);
  const one = runWater(await startModule({ bodies: 128 }), CHOP, scene, 240).last;
  const pool = await startThreaded(8, { bodies: 128 });
  try {
    const eight = runWater(pool.jolt, CHOP, scene, 240).last;
    assert.equal(eight.size, 100);
    assert.deepEqual(eight, one);
  } finally {
    await pool.close();
  }
});

test('water set or removed wakes every dynamic body, so one asleep floats or falls', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    const floor = new Mesh(box(), new Material('meshStandard'));
    floor.physics = 'static';
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.physics = 'dynamic';
    scene.add(floor, crate);
    physics.frame();
    const body = crate.physics;
    assert.ok(body);
    const woken = () => {
      worker.words.length = 0;
      physics.frame();
      // The frame's first command, before its view.
      return Array.from(worker.words[0].subarray(0, 2));
    };
    physics.handle.water = { waves: [], level: 2 };
    assert.deepEqual(woken(), [OP.wake, body._index]);
    physics.handle.water = null;
    assert.deepEqual(woken(), [OP.wake, body._index]);
    physics.dispose();
  } finally {
    restore();
  }
});
