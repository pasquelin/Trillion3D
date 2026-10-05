import test from 'node:test';
import assert from 'node:assert/strict';
import { createScaleControl } from './scaleControl.ts';
import { simulate } from './scaleFit.fixture.ts';
import { HISTORY } from './scaleTargets.ts';

// #831: a timer that answers but whose samples carry no time was stepped on neither the times nor
// the intervals: a page drawn in 40 ms on a 120 Hz display stayed at the display's size.
/** The scale of each of `frames` images of a timed device, each 40·s² ms at scale `s`, its GPU
 *  sample arriving two images late with `measured(ms)` as its time. */
function silent(frames: number, measured: (ms: number) => number | null) {
  return simulate(createScaleControl('auto'), frames, { gpu: (s) => 40 * s * s, measured }).scales;
}

/** The first image drawn at the floor, within `frames` of `scales`, and none after it at 1. */
function floorWithin(scales: number[], frames: number) {
  const floor = scales.indexOf(0.5);
  assert.ok(floor >= 0 && floor < frames, `${scales.slice(0, frames)}`);
  assert.ok(
    scales.slice(floor).every((s) => s < 1),
    'never back at the display size',
  );
}

test('40 ms GPU times drop the scale to its floor within the history', () => {
  floorWithin(
    silent(240, (ms) => ms),
    2 * HISTORY,
  );
});

test('samples without a time: the frame intervals drop the scale to its floor', () => {
  floorWithin(
    silent(240, () => null),
    12 * HISTORY,
  );
});

test('a sample without a time now and then leaves the GPU times in charge', () => {
  let sample = 0;
  floorWithin(
    silent(240, (ms) => (++sample % 5 ? ms : null)),
    2 * HISTORY,
  );
});
