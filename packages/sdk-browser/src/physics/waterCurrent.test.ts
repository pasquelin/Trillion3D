import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { WaterSpec } from '../../../sdk-core/src/fluids/index.ts';
import { startModule } from './module.fixture.ts';
import { cube, floater } from './water.fixture.ts';
import { createWaterStep } from './water.ts';

const CALM: WaterSpec = { waves: [], level: 0 };

async function floatingCube(water: WaterSpec, gravity = [0, -9.81, 0]) {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity(gravity);
  writer.add(floater(0, [0, -0.1, 0], 600, cube(0.5)));
  jolt.step(writer.take(), 0);
  const step = createWaterStep();
  step.set(water, 0);
  let pose = new Float32Array(0);
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      const count = step.step(jolt, null, 1 / 60);
      if (count) pose = new Float32Array(jolt.poses(count).slice().buffer);
    }
    return pose;
  };
  return { jolt, step, writer, advance };
}

test('a current accelerates a resting floater and carries it beyond the sleep interval', async () => {
  const { jolt, advance } = await floatingCube({ ...CALM, current: [0.4, 0, 0.12] });
  const first = advance(1);
  assert.ok(first[8] > 0 && first[10] > 0, 'water pushes even a body initially at rest');
  const early = advance(119);
  const later = advance(480);
  assert.ok(later[1] > early[1] + 0.1 && later[3] > early[3] + 0.03);
  assert.equal(jolt.active(), 1, 'the current continues acting');
});

test('calm water rests; changing current wakes it, and removing current lets it settle', async () => {
  const { jolt, step, writer, advance } = await floatingCube(CALM);
  advance(120);
  assert.equal(jolt.active(), 0, 'buoyancy alone does not prevent sleep');
  step.set({ ...CALM, current: [-0.4, 0, 0] }, 1);
  // The public water setter sends WAKE for each dynamic body (water.test.ts).
  writer.wake(0);
  step.step(jolt, writer.take(), 1 / 60);
  const carried = advance(600);
  assert.ok(carried[1] < -0.1 && carried[8] < 0);
  step.set(CALM, 2);
  advance(3600);
  assert.equal(jolt.active(), 0, 'a removed current does not permanently disable sleep');
});

test('a current without drag exerts no lateral force and permits sleep', async () => {
  const { jolt, advance } = await floatingCube({ ...CALM, current: [1, 0, 0], linearDrag: 0 });
  const resting = advance(120);
  assert.equal(resting[1], 0);
  assert.equal(jolt.active(), 0);
});

test('zero-density water exerts no force and does not keep a body awake', async () => {
  const { jolt, advance } = await floatingCube(
    { ...CALM, current: [0.4, 0, 0], density: 0 },
    [0, 0, 0],
  );
  const resting = advance(120);
  assert.equal(resting[1], 0);
  assert.equal(jolt.active(), 0);
});
