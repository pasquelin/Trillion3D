import assert from 'node:assert/strict';
import test from 'node:test';
import initJolt from 'jolt-physics/wasm';
import {
  H,
  idleInputs,
  STEP,
  type Inputs,
} from '../../../../../site/examples/kit/openworld/play/protocol.ts';
import {
  createSim,
  step,
  type Sim,
} from '../../../../../site/examples/kit/openworld/play/sim/core.ts';
import { FOOT } from '../../../../../site/examples/kit/openworld/play/sim/foot.ts';
import {
  playerPosition,
  teleport,
} from '../../../../../site/examples/kit/openworld/play/sim/player.ts';
import { writeSnapshot } from '../../../../../site/examples/kit/openworld/play/sim/snapshot.ts';
import type { ColliderInstance } from '../../../../../site/examples/kit/openworld/play/collision.ts';
import { fixtureWorld, LIMITS, slope, solidSource, tileHeights } from './fixture.ts';

/** Jolt's WebAssembly build, loaded in Node as the worker loads it in the browser. */
const J = await initJolt();

/** Five steps of 18 cm rising north of the start, in its tile: one unit block, scaled. */
const STAIRS: ColliderInstance[] = Array.from({ length: 5 }, (_, i) => ({
  prop: 'block',
  position: [40, slope(40, 0), -6 - i * 0.5],
  yaw: 0,
  scale: [3, 0.18 * (i + 1), 0.5],
}));

function world(limits = LIMITS) {
  return createSim(J, fixtureWorld(), limits, {
    heights: async (tx, tz) => tileHeights(tx, tz),
    colliders: solidSource({ '4_3': STAIRS }),
  });
}

/** Steps `seconds` of simulation, letting the tiles' fetches land between steps. */
async function run(sim: Sim, inputs: Inputs, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    step(sim, inputs, STEP);
    if (i % 4 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
}

const speedOf = (sim: Sim) => {
  const v = sim.walker.character.GetLinearVelocity();
  return Math.hypot(v.GetX(), v.GetZ());
};

test("the walker waits for its ground, then walks, runs, crouches and jumps at a person's pace", async () => {
  const sim = world();
  const inputs = idleInputs();
  step(sim, inputs, STEP);
  assert.equal(sim.holding, true);
  await run(sim, inputs, 1);
  assert.equal(sim.holding, false);
  inputs.lookYaw = Math.PI / 2;
  inputs.forward = 1;
  await run(sim, inputs, 2);
  assert.ok(Math.abs(speedOf(sim) - FOOT.walk) < 0.05, `walking at ${speedOf(sim)} m/s`);
  inputs.run = true;
  await run(sim, inputs, 2);
  assert.ok(Math.abs(speedOf(sim) - FOOT.run) < 0.1, `running at ${speedOf(sim)} m/s`);
  assert.ok(sim.walker.stamina < 1);
  inputs.run = false;
  inputs.crouch = true;
  await run(sim, inputs, 2);
  assert.ok(Math.abs(speedOf(sim) - FOOT.crouch) < 0.05, `crouching at ${speedOf(sim)} m/s`);
  inputs.crouch = false;
  inputs.forward = 0;
  await run(sim, inputs, 1);
  const before = playerPosition(sim)[1];
  inputs.jump = 1;
  let top = before;
  for (let i = 0; i < 60; i++) {
    await run(sim, inputs, STEP);
    top = Math.max(top, playerPosition(sim)[1]);
  }
  assert.ok(top - before > 0.6 && top - before < 1, `jumped ${top - before} m`);
});

test('the walker climbs stairs', async () => {
  const sim = world();
  const inputs = idleInputs();
  await run(sim, inputs, 1);
  inputs.forward = 1;
  let top = 0;
  for (let i = 0; i < 16; i++) {
    await run(sim, inputs, 0.5);
    const [x, y, z] = playerPosition(sim);
    top = Math.max(top, y - slope(x, z));
  }
  // The last step's top, 0.9 m up, is reached; beyond it the walker steps back down to the grass.
  assert.ok(top > 0.85, `${top.toFixed(2)} m up at most`);
  assert.ok(playerPosition(sim)[2] < -9, 'walked on past the stairs');
});

test('E takes the parked car, which is faster on the road than off it, and gives the walker back', async () => {
  const sim = world();
  const inputs = idleInputs();
  await run(sim, inputs, 1);
  inputs.use = 1;
  await run(sim, inputs, 1);
  assert.equal(sim.mode, 'car');
  inputs.forward = 1;
  await run(sim, inputs, 8);
  const grass = sim.physics.bodies.GetLinearVelocity(sim.car!.body.GetID()).Length();
  // Presses are counted: the idle keys keep the count, or the worker would see a new press.
  const idle = { ...idleInputs(), use: inputs.use };
  // Out, a teleport beside the highway's parked car, and in: E is the only way into a vehicle.
  teleport(sim, 'roadside');
  await run(sim, idle, 1);
  idle.use = inputs.use = 2;
  await run(sim, idle, 1);
  assert.equal(sim.mode, 'car');
  await run(sim, inputs, 8);
  const road = sim.physics.bodies.GetLinearVelocity(sim.car!.body.GetID()).Length();
  assert.ok(
    road > grass * 1.2,
    `${road.toFixed(1)} m/s on the highway, ${grass.toFixed(1)} on grass`,
  );
  inputs.forward = 0;
  inputs.brake = true;
  await run(sim, inputs, 4);
  inputs.use = 3;
  await run(sim, inputs, 1);
  assert.equal(sim.mode, 'foot');
});

test('far from the start the origin has followed, and positions stay exact', async () => {
  const sim = world();
  await run(sim, idleInputs(), 1);
  teleport(sim, 'far');
  await run(sim, idleInputs(), 2);
  const [x, y, z] = playerPosition(sim);
  assert.notDeepEqual(sim.physics.origin, { x: 0, z: 0 });
  assert.ok(Math.hypot(x - 3500, z - 3500) < 0.01 && Math.abs(y - slope(x, z)) < 0.1);
  const out = new Float32Array(sim.layout.length);
  writeSnapshot(sim, out);
  assert.ok(Math.abs(out[H.x] + out[H.originX] - x) < 0.01);
});

test('a step costs well under a frame with the traffic and the crowd at their bounds', async (t) => {
  const limits = { radius: 2500, traffic: 40, pedestrians: 60 };
  const sim = world(limits);
  const inputs = { ...idleInputs(), forward: 1 };
  await run(sim, inputs, 3);
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    step(sim, inputs, STEP);
    times.push(sim.stepMs);
  }
  times.sort((a, b) => a - b);
  const [median, p99] = [times[300], times[594]];
  t.diagnostic(
    `step ${median.toFixed(3)} ms median, ${p99.toFixed(3)} ms p99, ${sim.flow.cars.filter((c) => c.active).length} cars, ${sim.people.people.filter((p) => p.active).length} pedestrians`,
  );
  assert.ok(median < 4, `${median} ms a step`);
});
