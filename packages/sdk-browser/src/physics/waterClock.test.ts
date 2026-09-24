import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { createWaterClock } from './waterClock.ts';

test('the waves’ clock sums the ticks received, runs on one step at most, never backwards', () => {
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  waves.reset(0);
  waves.received(2 * PHYSICS_STEP, 100);
  assert.equal(waves.time(100), 2 * PHYSICS_STEP);
  assert.ok(Math.abs(waves.time(108) - (2 * PHYSICS_STEP + 0.008)) < 1e-12, 'carried on');
  assert.equal(waves.time(1000), 3 * PHYSICS_STEP, 'one step past the last tick at most');
  // A tick that simulates less than what was shown ahead does not bring the waves back.
  waves.received(PHYSICS_STEP / 2, 1001);
  assert.equal(waves.time(1001), 3 * PHYSICS_STEP);
  clock.timeScale = 0.25;
  assert.equal(waves.time(1009), 3 * PHYSICS_STEP, 'slow motion carries on four times slower, never back');
  clock.paused = true;
  waves.received(PHYSICS_STEP, 2000);
  assert.equal(waves.time(3000), 3.5 * PHYSICS_STEP, 'paused, the waves stand still');
  waves.reset(3000);
  assert.equal(waves.time(3000), 0, 'the water set again starts at 0 s, as the worker’s');
});
