import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { createWaterClock } from './waterClock.ts';
import { createWaterStep } from './water.ts';

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, what);

test('bodies awake, the waves’ clock follows the ticks, one step ahead at most, never back', () => {
  const clock = { paused: false, timeScale: 1 };
  const waves = createWaterClock(clock);
  waves.reset(0);
  waves.received(2 * PHYSICS_STEP, 3, 100);
  assert.equal(waves.time(100), 2 * PHYSICS_STEP);
  near(waves.time(108), 2 * PHYSICS_STEP + 0.008, 'carried on between two ticks');
  assert.equal(waves.time(1000), 3 * PHYSICS_STEP, 'one step past the last tick at most');
  // A tick that simulates less than what was shown ahead does not bring the waves back.
  waves.received(2.5 * PHYSICS_STEP, 3, 1001);
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
  waves.reset(0);
  // The last tick before sleep: no body awake, no tick will follow.
  waves.received(1, 0, 1000);
  near(waves.time(3000), 3, 'two seconds later the waves moved on two seconds');
  // Slowed while asleep: the two seconds already run are kept, the rest runs four times slower.
  waves.retime(3000);
  clock.timeScale = 0.25;
  near(waves.time(7000), 4, 'slowed at rest');
  clock.timeScale = 1;
  // The worker did the same: its water ran on through the rest, the bodies it wakes float on it.
  const worker = createWaterStep();
  worker.set({ waves: [], level: 0 });
  worker.rest(1);
  worker.rest(3);
  assert.equal(worker.time, 4);
  waves.received(worker.time + PHYSICS_STEP, 5, 7016);
  near(waves.time(7016), 4 + PHYSICS_STEP, 'awake again, the ticks lead the clock');
  worker.set(null);
  worker.rest(2);
  assert.equal(worker.time, 0, 'no water, no clock');
});
