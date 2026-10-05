import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { fakeWorkers, idleTick, loaded, poseRecord } from './worker.fixture.ts';
import { createWorldPhysics } from './worldPhysics.ts';

/** A world's physics on a fake worker, ready, one crate in it; `told` lists the kinds of what the
 *  page sent since the last call, advances with their numbers. */
async function world() {
  const sent: { type: string; to?: number; steps?: number; at?: number }[] = [];
  const { workers, restore } = fakeWorkers((message) => sent.push(message as never));
  const scene = new Group();
  const runtime = { invalidate() {}, explorer: null };
  const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
  await loaded();
  const [worker] = workers;
  worker.onmessage({ data: { type: 'ready' } });
  sent.length = 0; // the start, the gravity and the clock it starts with
  const crate = new Mesh(box(), new Material('meshStandard'));
  crate.physics = 'dynamic';
  scene.add(crate);
  const told = () =>
    sent
      .splice(0)
      .filter((m) => m.type === 'commands' || m.type === 'advance' || m.type === 'water')
      .map((m) =>
        m.type === 'advance'
          ? `advance ${m.to}/${m.steps}`
          : m.type === 'water'
            ? `water at ${m.at}`
            : m.type,
      );
  /** The worker's results after the steps up to `step`, the crate at `y`, the page's first
   *  `heard` waking messages run. */
  const tick = (step: number, y: number, resting: boolean, heard = 1) => {
    const id = physics.session()!.engineIdOf(crate);
    const words = poseRecord(id, [0, y, 0, 0, 0, 0, 1]);
    const active = resting ? 0 : 1;
    const data = { ...idleTick, buffer: words.buffer, poses: 1, steps: 1, step, resting, active };
    worker.onmessage({ data: { ...data, heard } });
  };
  /** A frame `seconds` after the last: its time set, then run (`worldFrames.ts`). */
  const frame = (seconds: number) => (physics.time(seconds), physics.frame());
  return { physics, worker, told, tick, frame, restore };
}

test('a frame sends its commands, then the steps it owes; a world at rest is sent nothing', async () => {
  const { told, tick, frame, restore } = await world();
  try {
    frame(0);
    assert.deepEqual(told(), ['commands'], 'a frame of no time owes no step');
    assert.equal(frame(PHYSICS_STEP), true, 'awake: the next frame is asked for');
    assert.deepEqual(told(), ['advance 1/1']);
    tick(1, 4.9, false);
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), ['advance 2/1']);
    tick(2, 4.8, true);
    const asked = [1, 2, 3].map(() => frame(PHYSICS_STEP));
    assert.deepEqual(told(), [], 'at rest: no message');
    assert.equal(asked.at(-1), false, 'and no frame asked for once the last state is drawn');
  } finally {
    restore();
  }
});

test('a word of rest from before the page woke the world again keeps it stepping', async () => {
  const { physics, worker, told, tick, frame, restore } = await world();
  try {
    frame(PHYSICS_STEP);
    tick(1, 4.9, true);
    told();
    // The page wakes the world: its commands, then the frame's step, in that order.
    physics.handle.gravity = 'moon';
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), ['commands', 'advance 2/1']);
    // A rest the worker found before those commands ran says nothing of them.
    tick(1, 4.9, true);
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), ['advance 3/1'], 'still stepping');
    // The worker's word once it ran them: at rest.
    worker.onmessage({ data: { type: 'rest', step: 3, heard: 2 } });
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), []);
  } finally {
    restore();
  }
});

test('paused, a frame owes nothing and asks for none; its commands still run, in place', async () => {
  const { physics, told, frame, restore } = await world();
  try {
    physics.handle.paused = true;
    assert.equal(frame(PHYSICS_STEP), false);
    assert.deepEqual(told(), ['commands', 'advance 0/0'], 'an advance of no step runs them');
    physics.handle.paused = false;
    assert.equal(frame(PHYSICS_STEP), true);
    assert.deepEqual(told(), ['advance 1/1']);
  } finally {
    restore();
  }
});

test('a world a run in place left at rest is asked no step after it', async () => {
  const { physics, worker, told, frame, restore } = await world();
  try {
    physics.handle.paused = true;
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), ['commands', 'advance 0/0']);
    // The worker ran them in place, after the page's one waking message: at rest.
    worker.onmessage({ data: { ...idleTick, resting: true, heard: 1 } });
    physics.handle.paused = false;
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), [], 'nothing asked of a world at rest');
  } finally {
    restore();
  }
});

test('a worker that falls behind is asked no more than a frame can draw past its newest state', async () => {
  const { told, tick, frame, restore } = await world();
  try {
    frame(0);
    told();
    // It answers nothing: the frames' clock waits for it, the steps beyond its reach dropped.
    for (let f = 0; f < 3 * MAX_CATCH_UP_STEPS; f++) frame(PHYSICS_STEP);
    const ahead = MAX_CATCH_UP_STEPS + 1;
    const asked = Array.from({ length: ahead }, (_, i) => `advance ${i + 1}/1`);
    assert.deepEqual(told(), asked, 'slow motion, never a growing backlog');
    tick(ahead, 4, false);
    frame(PHYSICS_STEP);
    assert.deepEqual(told(), [`advance ${ahead + 1}/1`], 'once it delivers, the clock runs on');
  } finally {
    restore();
  }
});

test('water set while a frame runs starts at the step the worker then stands at', async () => {
  const { physics, told, tick, frame, restore } = await world();
  try {
    frame(PHYSICS_STEP);
    tick(1, 4.9, false);
    told();
    // A controller sets it after the frame's time owed a step: it reaches the worker before it.
    physics.time(PHYSICS_STEP);
    physics.handle.water = { waves: [], level: 0 };
    physics.frame();
    assert.deepEqual(told(), ['water at 1', 'commands', 'advance 2/1']);
  } finally {
    restore();
  }
});
