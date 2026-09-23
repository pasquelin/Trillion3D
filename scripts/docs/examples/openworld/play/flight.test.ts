import assert from 'node:assert/strict';
import test from 'node:test';
import { rotate } from '../../../../../site/examples/kit/openworld/play/math3.ts';
import {
  AIRCRAFT,
  aircraft,
  fly,
  liftRatio,
  type FlightInput,
} from '../../../../../site/examples/kit/openworld/play/sim/flight.ts';

const STEP = 1 / 60;
const flat = () => 0;
const hold = (overrides: Partial<FlightInput> = {}): FlightInput => ({
  throttle: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  brake: false,
  ...overrides,
});

/** An aircraft already flying level at `speed`, `height` metres over flat ground. */
function flying(speed: number, height = 1000) {
  const plane = aircraft([0, height, 0], 0);
  Object.assign(plane, { speed, onGround: false, throttle: 0.6 });
  return plane;
}

test('lift grows with the square of speed and carries the weight from the stall speed on', () => {
  assert.equal(liftRatio(0), 0);
  assert.ok(liftRatio(AIRCRAFT.stall / 2) < liftRatio(AIRCRAFT.stall));
  assert.equal(liftRatio(AIRCRAFT.stall), 1);
  assert.equal(liftRatio(AIRCRAFT.stall * 10), 2.5);
});

test('above the stall speed a level aircraft holds its height; below it, it stalls and sinks', () => {
  const cruising = flying(AIRCRAFT.stall * 2);
  const slow = flying(AIRCRAFT.stall * 0.6);
  fly(slow, hold(), STEP, flat);
  assert.equal(slow.stalled, true);
  for (let i = 0; i < 5 * 60; i++) {
    fly(cruising, hold(), STEP, flat);
    fly(slow, hold(), STEP, flat);
  }
  assert.ok(Math.abs(cruising.position[1] - 1000) < 30, `cruise at ${cruising.position[1]} m`);
  assert.equal(cruising.stalled, false);
  assert.ok(slow.position[1] < 975, `stalled aircraft at ${slow.position[1]} m`);
  // A stall drops the nose.
  assert.ok(rotate(slow.orientation, [0, 0, -1])[1] < -0.05);
});

test('it rolls down the runway, lifts off only when rotated, and climbs', () => {
  const plane = aircraft([0, AIRCRAFT.gear, 0], 0);
  for (let i = 0; i < 25 * 60; i++) fly(plane, hold({ throttle: 1 }), STEP, flat);
  assert.ok(plane.speed > AIRCRAFT.stall, `${plane.speed} m/s on the ground`);
  assert.equal(plane.onGround, true);
  for (let i = 0; i < 60; i++) fly(plane, hold({ pitch: 0.3 }), STEP, flat);
  for (let i = 0; i < 10 * 60; i++) fly(plane, hold(), STEP, flat);
  assert.equal(plane.onGround, false);
  assert.ok(plane.position[1] > 100, `climbed to ${plane.position[1]} m`);
});

test('a banked aircraft turns towards the lower wing', () => {
  const plane = flying(90);
  for (let i = 0; i < 30; i++) fly(plane, hold({ roll: 1 }), STEP, flat);
  for (let i = 0; i < 5 * 60; i++) fly(plane, hold(), STEP, flat);
  const nose = rotate(plane.orientation, [0, 0, -1]);
  assert.ok(nose[0] > 0.2, `nose ${nose.map((v) => v.toFixed(2))} after a right bank`);
});

test('at full throttle the map takes minutes to cross', () => {
  const plane = flying(AIRCRAFT.stall * 1.5);
  plane.throttle = 1;
  for (let i = 0; i < 90 * 60; i++) fly(plane, hold({ throttle: 1 }), STEP, flat);
  const minutes = 50_000 / plane.speed / 60;
  assert.ok(minutes > 3 && minutes < 10, `${minutes.toFixed(1)} min for 50 km`);
});
