import test from 'node:test';
import assert from 'node:assert/strict';
import { joint } from '../../../sdk-core/src/physics/index.ts';
import { jointRig } from './joints.fixture.ts';

/** Two cubes launched at 10 m/s without gravity, one declaring no damping: their speeds after 1 s. */
async function speedsAfterOneSecond() {
  const rig = await jointRig([0, 0, 0]);
  const kept = rig.cube(0, 0, 0);
  kept.physics = { type: 'dynamic', damping: { linear: 0 } };
  const unset = rig.cube(0, 0, 5);
  rig.run(1);
  for (const cube of [kept, unset]) rig.writer.velocity(cube.physics!._index, [10, 0, 0]);
  rig.run(59);
  const before = [rig.at(kept)[0], rig.at(unset)[0]];
  rig.run(1);
  return [(rig.at(kept)[0] - before[0]) * 60, (rig.at(unset)[0] - before[1]) * 60];
}

test('a body declaring no damping keeps its speed in free flight; one left unset loses 5 % a second', async () => {
  const [kept, unset] = await speedsAfterOneSecond();
  assert.ok(Math.abs(kept - 10) < 1e-3, `no damping: ${kept} m/s`);
  // Jolt's own 0.05 per second, applied step by step: 10 × (1 − 0.05 / 60)^60.
  assert.ok(Math.abs(unset - 10 * (1 - 0.05 / 60) ** 60) < 1e-2, `default damping: ${unset} m/s`);
});

/** Two cubes spun at 1 rad/s on frictionless hinges, then let go, one declaring no angular
 *  damping: their spins 1 s later. */
async function spinsAfterOneSecond() {
  const rig = await jointRig([0, 0, 0]);
  const kept = rig.cube(0, 0, 0);
  kept.physics = { type: 'dynamic', damping: { angular: 0 } };
  const unset = rig.cube(0, 0, 5);
  const drive = { mode: 'velocity' as const, target: 1, maxForce: 1e6 };
  const hinges = [kept, unset].map((cube) => joint.hinge(cube, null, { motor: drive }));
  for (const hinge of hinges) rig.wanted.add(hinge);
  rig.run(30);
  for (const hinge of hinges) hinge.motor = null;
  rig.run(59);
  const before = [rig.yaw(kept), rig.yaw(unset)];
  rig.run(1);
  return [(rig.yaw(kept) - before[0]) * 60, (rig.yaw(unset) - before[1]) * 60];
}

test('a body declaring no angular damping keeps its spin; one left unset loses 5 % a second', async () => {
  const [kept, unset] = await spinsAfterOneSecond();
  assert.ok(Math.abs(kept - 1) < 1e-3, `no angular damping: ${kept} rad/s`);
  assert.ok(
    Math.abs(unset - (1 - 0.05 / 60) ** 60) < 1e-3,
    `default angular damping: ${unset} rad/s`,
  );
});
