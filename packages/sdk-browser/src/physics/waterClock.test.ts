import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { createWaterClock } from './waterClock.ts';
import { createWaterStep } from './water.ts';

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, what);

test('bodies awake, the waves’ clock follows the ticks, one step ahead at most, never back', () => {
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  const epoch = waves.reset(0);
  waves.received(2 * PHYSICS_STEP, 3, 100, epoch);
  assert.equal(waves.time(100), 2 * PHYSICS_STEP);
  near(waves.time(108), 2 * PHYSICS_STEP + 0.008, 'carried on between two ticks');
  assert.equal(waves.time(1000), 3 * PHYSICS_STEP, 'one step past the last tick at most');
  // A tick that simulates less than what was shown ahead does not bring the waves back.
  waves.received(2.5 * PHYSICS_STEP, 3, 1001, epoch);
  assert.equal(waves.time(1001), 3 * PHYSICS_STEP);
  waves.retime(1001);
  clock.timeScale = 0.25;
  near(waves.time(1041), 3 * PHYSICS_STEP + 0.01, 'slow motion carries on four times slower');
  waves.retime(2000);
  clock.paused = true;
  const held = waves.time(2000);
  assert.equal(waves.time(3000), held, 'paused, the waves stand still');
  waves.reset(3000);
  assert.equal(waves.time(3000), 0, 'the water set again starts at 0 s, as the worker’s');
});

test('every body asleep, the drawn waves run on, and the waking worker meets them', () => {
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  const epoch = waves.reset(0);
  // The last tick before sleep: no body awake, no tick will follow.
  waves.received(1, 0, 1000, epoch);
  near(waves.time(3000), 3, 'two seconds later the waves moved on two seconds');
  // Slowed while asleep: the two seconds already run are kept, the rest runs four times slower.
  waves.retime(3000);
  clock.timeScale = 0.25;
  near(waves.time(7000), 4, 'slowed at rest');
  clock.timeScale = 1;
  // The worker did the same: its water ran on through the rest, the bodies it wakes float on it.
  const worker = createWaterStep();
  worker.set({ waves: [], level: 0 }, epoch);
  worker.rest(1);
  worker.rest(3);
  assert.equal(worker.time, 4);
  waves.received(worker.time + PHYSICS_STEP, 5, 7016, worker.epoch);
  near(waves.time(7016), 4 + PHYSICS_STEP, 'awake again, the ticks lead the clock');
  worker.set(null, epoch + 1);
  worker.rest(2);
  assert.equal(worker.time, 0, 'no water, no clock');
});

test('a tick stepped before the last water was set is ignored: the new waves start at 0 s', () => {
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  const old = waves.reset(0);
  waves.received(10, 3, 1000, old);
  const fresh = waves.reset(2000);
  // In flight when the water was set: its clock is the old water's, ten seconds ahead.
  waves.received(10 + PHYSICS_STEP, 3, 2001, old);
  near(waves.time(2001), 0.001, 'the new water, carried on from 0 s by the page');
  waves.received(PHYSICS_STEP, 3, 2016, fresh);
  assert.equal(waves.time(2016), PHYSICS_STEP, 'a tick on the new water is heard');
});
