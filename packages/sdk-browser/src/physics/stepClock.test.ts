import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { createStepClock } from './stepClock.ts';
import { createWaterStep } from './water.ts';

test('water set on a resting world steps no rest time on the new water', () => {
  const water = createWaterStep();
  const clock = createStepClock(water);
  clock.start(0);
  clock.tick(0);
  assert.equal(clock.step(), false, 'nothing owed at the start');
  // Five seconds asleep, then new water: its waves start at 0 s, and the rest belongs to the old.
  water.set({ waves: [], level: 0 }, 1);
  clock.water(5000, true);
  clock.tick(5000);
  assert.equal(clock.owed, 0);
  assert.equal(clock.step(), false);
});

test('a tick owes the time since the last one, capped; a resting world woken steps at once', () => {
  const water = createWaterStep();
  water.set({ waves: [], level: 0 }, 1);
  const clock = createStepClock(water);
  clock.start(0);
  clock.tick(10_000);
  assert.equal(clock.owed, MAX_CATCH_UP_STEPS * PHYSICS_STEP, 'a ceiling of catch-up steps');
  while (clock.step());
  assert.ok(clock.owed < PHYSICS_STEP);
  // Asleep two seconds: the waves ran on, and the command just sent is owed now.
  clock.wake(12_000, true);
  assert.equal(water.time, 2);
  assert.ok(clock.step());
  // Paused: nothing owed, the waves stand still.
  clock.set(12_000, true, true, 1);
  clock.tick(20_000);
  assert.equal(clock.step(), false);
  clock.wake(21_000, true);
  assert.equal(water.time, 2);
});
