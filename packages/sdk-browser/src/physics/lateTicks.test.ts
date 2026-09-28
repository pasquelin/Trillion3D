import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandWriter,
  MAX_CATCH_UP_STEPS,
  PHYSICS_STEP,
  POSE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { composeMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Compose.ts';
import { startModule } from './module.fixture.ts';
import { createPhysicsPoses } from './poses.ts';
import { startedWorker } from './worker.fixture.ts';
import { resultWords } from './protocol.ts';
import { body } from './records.fixture.ts';
import { records, seated } from './seatedPoses.fixture.ts';

test("a worker late by slow steps changes none of the page's frames: each draws every body once", (t) => {
  // The same frames, 8 ms apart, against a worker at one step a tick and one at four steps a
  // tick, each step 25 ms long: the page draws on, a late tick interpolated then extrapolated.
  for (const [steps, every] of [
    [1, PHYSICS_STEP * 1000],
    [MAX_CATCH_UP_STEPS, MAX_CATCH_UP_STEPS * 25],
  ]) {
    let clock = 0;
    t.mock.method(performance, 'now', () => clock);
    const { scene, placed, bodies } = seated(3);
    const poses = createPhysicsPoses(3, scene);
    for (let frame = 0, next = 0, y = 0; frame < 60; frame++, clock += 8) {
      if (clock >= next) {
        poses.receive(records(3, (y += steps), 1), 3, bodies, steps * PHYSICS_STEP * 1000);
        next += every;
      }
      placed.length = 0;
      assert.equal(poses.apply(bodies), true, `frame ${frame} asks for the next`);
      assert.deepEqual(placed, [3], `frame ${frame} writes the three rows once`);
    }
  }
});

test('every row drawn is its body pose composed: short of the target, on it and past it', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { scene, batch, meshes, bodies } = seated(3);
  const poses = createPhysicsPoses(3, scene);
  const expect = (label: string) =>
    meshes.forEach((mesh, row) => {
      const composed = composeMatrix4(
        new Float64Array(16),
        mesh.position.elements,
        mesh.quaternion.elements,
        mesh.scale.elements,
      );
      assert.deepEqual(batch.rows.matrices.subarray(row * 16, row * 16 + 16), composed, label);
      mesh.updateWorldMatrix(true, false);
      assert.deepEqual(mesh.matrixWorld.elements, composed, `${label}: the tree holds it`);
      assert.ok(Math.abs(Math.hypot(...mesh.quaternion.elements) - 1) < 1e-6, `${label}: a turn`);
    });
  poses.receive(records(3, 1, 0), 3, bodies, 16);
  clock = 16;
  poses.apply(bodies);
  poses.receive(records(3, 2, 3), 3, bodies, 16);
  clock += 8;
  poses.apply(bodies);
  expect('short of the target');
  assert.ok(meshes[0].position.y > 1 && meshes[0].position.y < 2);
  clock += 20;
  poses.apply(bodies);
  expect('past it, moved on by its velocity');
  assert.ok(meshes[0].position.y > 2);
  poses.receive(records(3, 4, 0, true), 3, bodies, 16);
  clock += 40;
  poses.apply(bodies);
  expect('on it, asleep');
  assert.equal(meshes[2].position.y, 6);
});

test('a record that meets a body on its way is its target, though it holds the drawn pose', (t) => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const { scene, meshes, bodies } = seated(1);
  const poses = createPhysicsPoses(1, scene);
  poses.receive(records(1, 2, 0), 1, bodies, 16);
  clock = 8;
  poses.apply(bodies);
  assert.equal(meshes[0].position.y, 1, 'halfway');
  // The next record holds the pose drawn halfway: the body stops there, not at the old target.
  poses.receive(records(1, 1, 0), 1, bodies, 16);
  clock += 40;
  poses.apply(bodies);
  assert.equal(meshes[0].position.y, 1);
});

test('slow steps never cost the worker a step: the ceiling a tick, each one fixed, in order', async () => {
  // The worker's clock: a step reads it before and after, and each step is 25 ms long.
  let now = 0,
    reads = 0;
  const clock = () => {
    const read = now;
    if (reads++ % 2 === 1) now += 25;
    return read;
  };
  const { ticks, sent, receive, budget } = await startedWorker(clock);
  ticks.shift()![0]();
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add(body(0, 2, 10, 0.5));
  const words = writer.take();
  reads = 0;
  receive({ type: 'commands', words: words.slice() });
  let taken = 0;
  while (taken < 40) {
    const [tick, ms] = ticks.shift()!;
    now += ms;
    reads = 0;
    tick();
    const results = sent.filter((m) => m.type === 'results').slice(-1)[0];
    taken += results.steps;
    receive({ type: 'buffer', buffer: new ArrayBuffer(resultWords(budget) * 4) });
  }
  const results = sent.filter((m) => m.type === 'results');
  for (const tick of results) {
    assert.ok(tick.steps >= 1 && tick.steps <= MAX_CATCH_UP_STEPS, `${tick.steps} steps a tick`);
    assert.equal(tick.seconds, tick.steps * PHYSICS_STEP, 'fixed steps, never stretched');
    assert.equal(tick.poses, 1, "one record a body, whatever the tick's steps");
  }
  assert.ok(
    results.some((tick) => tick.steps === MAX_CATCH_UP_STEPS),
    'the ceiling holds',
  );
  assert.ok(taken * PHYSICS_STEP * 1000 < now, 'the simulation lags real time, never skips');
  // The same steps, one after the other, straight on the module: the same body, to the bit.
  const jolt = await startModule({ bodies: 8 });
  jolt.step(words, PHYSICS_STEP);
  for (let step = 1; step < taken; step++) jolt.step(null, PHYSICS_STEP);
  const last = new Uint32Array(results.at(-1)!.buffer, 0, POSE_WORDS);
  assert.deepEqual(last, jolt.poses(1).slice(0, POSE_WORDS));
});
