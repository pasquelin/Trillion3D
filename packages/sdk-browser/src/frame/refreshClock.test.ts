import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshClock } from './refreshClock.ts';

const near = (value: number, expected: number) => Math.abs(value - expected) < 0.01;

test('the refresh interval is the period several intervals share, pauses aside', () => {
  const clock = createRefreshClock(1000 / 60);
  assert.equal(clock.interval, 1000 / 60, 'the fallback before any frame');
  let now = 0;
  for (const gap of [0, 8.4, 16.7, 8.3, 500, 8.3]) clock.tick((now += gap));
  assert.ok(near(clock.interval, 8.3), `${clock.interval}`);
});

/** The refresh measured from frames drawn every `frameMs` on a display refreshing every `vsyncMs`:
 *  each frame begins at the first refresh after it is ready, as rAF does. */
function measured(vsyncMs: number, frameMs: number) {
  const clock = createRefreshClock(1000 / 60);
  for (let frame = 0; frame < 60; frame++)
    clock.tick(Math.ceil((frame * frameMs) / vsyncMs - 1e-9) * vsyncMs);
  return clock.interval;
}

// #1343: the budget follows the display, no fixed cap; slow frames never pass for a slow display.
test('the refresh budget follows the display, a device that misses its cadence included', () => {
  assert.ok(near(measured(1000 / 120, 1000 / 120), 8.33), '120 Hz: 8.3 ms');
  assert.ok(near(measured(1000 / 60, 1000 / 60), 16.67), '60 Hz: 16.7 ms');
  assert.ok(near(measured(1000 / 120, 1000 / 16), 8.33), '16 fps at 120 Hz: 8.3 ms');
});

// #1343: the shortest interval was the period, so one late frame set a 2.5 ms budget.
test('one late frame sets no period', () => {
  const clock = createRefreshClock(1000 / 60);
  let now = 0;
  for (let frame = 0; frame < 60; frame++) clock.tick((now += 1000 / 120) + (frame === 30 ? 6 : 0));
  assert.ok(near(clock.interval, 8.33), `${clock.interval}`);
});

// #1343: a period held while each interval stayed on its grid never rose.
test('the period rises once the display slows, and a reset forgets the old one', () => {
  const clock = createRefreshClock(1000 / 60);
  let now = 0;
  for (let frame = 0; frame < 120; frame++) clock.tick((now += 1000 / 120));
  for (let frame = 0; frame < 30; frame++) clock.tick((now += 1000 / 60));
  assert.ok(near(clock.interval, 8.33), 'a second holds the old display');
  for (let frame = 0; frame < 40; frame++) clock.tick((now += 1000 / 60));
  assert.ok(near(clock.interval, 16.67), `then the new one: ${clock.interval}`);
  clock.reset();
  assert.equal(clock.settled, false);
  for (let frame = 0; frame < 4; frame++) clock.tick((now += 1000 / 30));
  assert.ok(near(clock.interval, 33.33) && clock.settled, 'a reset measures anew at once');
});
