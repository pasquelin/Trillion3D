import test from 'node:test';
import assert from 'node:assert/strict';
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
