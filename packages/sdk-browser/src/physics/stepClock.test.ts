import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { createStepClock, physicsStep } from './stepClock.ts';

/** The steps each frame of `deltas` (seconds) owes on a fresh clock of `step`. */
const owed = (deltas: number[], step = PHYSICS_STEP) => {
  const clock = createStepClock(step);
  return deltas.map((seconds) => clock.frame(seconds));
};

test('the same frame times owe the same whole steps, whatever runs them', () => {
  // A 60 Hz display's grid, a dropped frame, a 144 Hz run: the steps of each frame are its time's.
  const deltas = [0, 1 / 60, 1 / 60, 2 / 60, 1 / 144, 1 / 144, 1 / 144, 1 / 60];
  const first = owed(deltas);
  assert.deepEqual(first, owed(deltas), 'the same numbers twice');
  assert.deepEqual(first, [0, 1, 1, 2, 0, 0, 1, 1]);
  const clock = createStepClock(PHYSICS_STEP);
  for (const seconds of deltas) clock.frame(seconds);
  assert.equal(clock.steps, 6, 'every step the frames lived, none lost to rounding');
});

test('a frame owes the catch-up ceiling at most: past it, its time is dropped', () => {
  const clock = createStepClock(PHYSICS_STEP);
  assert.equal(clock.frame(10), MAX_CATCH_UP_STEPS, 'ten seconds owe the ceiling');
  clock.frame(0);
  // Four steps taken off the ceiling leave its rounding alone, far short of a step.
  assert.ok(clock.drawn.owed < 1e-15, 'nothing left over: slow motion, never a spiral');
  assert.equal(clock.frame(PHYSICS_STEP), 1, 'the next frame owes its own time');
});

test('paused or slowed, a frame owes its scaled time; a clock that steps back owes nothing', () => {
  const clock = createStepClock(PHYSICS_STEP);
  clock.paused = true;
  assert.equal(clock.frame(1), 0, 'paused');
  clock.paused = false;
  clock.timeScale = 0.25;
  assert.deepEqual(
    [1, 2, 3, 4].map(() => clock.frame(PHYSICS_STEP)),
    [0, 0, 0, 1],
    'a quarter',
  );
  clock.timeScale = 1;
  const before = clock.steps;
  assert.equal(clock.frame(-0.04), 0, 'a frame 40 ms back');
  assert.equal(clock.frame(Number.NaN), 0, 'a frame of no time');
  assert.equal(clock.steps, before);
});

test('a frame is drawn where the frame before left the clock, one step behind it', () => {
  const clock = createStepClock(PHYSICS_STEP);
  clock.frame(0);
  assert.deepEqual(clock.drawn, { step: -1, owed: 0 }, 'before any step');
  clock.frame(1.5 * PHYSICS_STEP);
  clock.frame(PHYSICS_STEP);
  // The frame before stood 1.5 steps in: drawn half a step past step 0, its state and step 1's
  // bracketing it, both asked for by the frames before.
  assert.equal(clock.drawn.step, 0);
  assert.ok(Math.abs(clock.drawn.owed - PHYSICS_STEP / 2) < 1e-15);
  assert.equal(clock.steps, 2);
  // The water set at step 1: its waves stand at 0 s until the time drawn reaches it.
  assert.equal(clock.since(1), 0);
  clock.frame(PHYSICS_STEP);
  assert.ok(Math.abs(clock.since(1) - PHYSICS_STEP / 2) < 1e-15, 'then run on with it');
});

test('a clock held at a step waits there, the time beyond dropped, never run back', () => {
  const clock = createStepClock(PHYSICS_STEP);
  assert.equal(clock.frame(2.5 * PHYSICS_STEP, 2), 2, 'two steps, the half beyond dropped');
  assert.equal(clock.frame(PHYSICS_STEP, 2), 0, 'at its limit, it waits');
  assert.deepEqual(clock.drawn, { step: 1, owed: 0 });
  assert.equal(clock.frame(PHYSICS_STEP / 2, 4), 0);
  assert.equal(clock.frame(PHYSICS_STEP / 2, 4), 1, 'freed, it runs on from where it waited');
});

test('the fixed step is 1/60 s unless the address names another rate', () => {
  // Node has no address: the default, read once and held.
  assert.equal(physicsStep(), PHYSICS_STEP);
  assert.deepEqual(owed([1 / 60, 1 / 60], 1 / 120), [2, 2], 'at 120 Hz, two steps a 60 Hz frame');
});
