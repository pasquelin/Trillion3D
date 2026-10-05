import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshClock } from './refreshClock.ts';

const near = (value: number, expected: number) => Math.abs(value - expected) < 0.01;

test('the refresh interval is the period several intervals share, pauses aside', () => {
  const clock = createRefreshClock(1000 / 60);
  assert.equal(clock.display, 1000 / 60, 'the fallback before any frame');
  let now = 0;
  for (const gap of [0, 8.4, 16.7, 8.3, 500, 8.3]) clock.tick((now += gap));
  // The period that fits them all: 41.7 ms over five refreshes.
  assert.ok(near(clock.display, 8.34), `${clock.display}`);
});

/** The refresh measured from frames drawn every `frameMs` on a display refreshing every `vsyncMs`:
 *  each frame begins at the first refresh after it is ready, as rAF does. */
function measured(vsyncMs: number, frameMs: number) {
  const clock = createRefreshClock(1000 / 60);
  for (let frame = 0; frame < 60; frame++)
    clock.tick(Math.ceil((frame * frameMs) / vsyncMs - 1e-9) * vsyncMs);
  return clock.display;
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
  assert.ok(near(clock.display, 8.33), `${clock.display}`);
});

// #1343: a period held while each interval stayed on its grid never rose. #831: the cadence of
// frames held two refreshes is no slower display: the refresh holds until its reader says so.
test('the cadence rises once the display slows, the refresh holds, and a reset forgets both', () => {
  const clock = createRefreshClock(1000 / 60);
  let now = 0;
  for (let frame = 0; frame < 120; frame++) clock.tick((now += 1000 / 120));
  for (let frame = 0; frame < 30; frame++) clock.tick((now += 1000 / 60));
  assert.ok(near(clock.cadence, 8.33), 'a second holds the old cadence');
  for (let frame = 0; frame < 40; frame++) clock.tick((now += 1000 / 60));
  assert.ok(near(clock.cadence, 16.67), `then the new one: ${clock.cadence}`);
  assert.ok(near(clock.display, 8.33), `the refresh holds: ${clock.display}`);
  clock.reset();
  assert.equal(clock.settled, false);
  assert.ok(Number.isNaN(clock.cadence));
  for (let frame = 0; frame < 4; frame++) clock.tick((now += 1000 / 30));
  assert.ok(near(clock.display, 33.33) && clock.settled, 'a reset measures anew at once');
});

// #831: the refresh is at most the shortest period the display held; intervals are whole numbers
// of it, so a 60 Hz display, whatever its frames miss, never shows a 120 Hz grid.
test('a shorter cadence lowers the refresh at once; a 60 Hz display never reads 120 Hz', () => {
  const clock = createRefreshClock(1000 / 60);
  let now = 0;
  for (let frame = 0; frame < 60; frame++) clock.tick((now += 1000 / 60));
  assert.ok(near(clock.display, 16.67), 'two refreshes of 120 Hz from the first read as 60 Hz');
  for (let frame = 0; frame < 3; frame++) clock.tick((now += 1000 / 120));
  assert.ok(near(clock.display, 8.33), `three at one refresh prove 120 Hz: ${clock.display}`);
  const sixty = createRefreshClock(1000 / 120);
  now = 0;
  for (let frame = 0; frame < 600; frame++) {
    // One, two or three refreshes, a ±0.3 ms jitter, as frames that miss and a compositor's.
    sixty.tick((now += (1 + (frame % 3)) * (1000 / 60) + 0.3 * Math.sin(frame)));
    if (sixty.settled)
      assert.ok(Math.abs(sixty.display - 1000 / 60) < 0.2, `frame ${frame}: ${sixty.display}`);
  }
  assert.ok(sixty.settled);
});

// #1343: a timer rounded to whole milliseconds reads 120 Hz as 8 and 9 ms, which a tenth of the
// period (0.83 ms) never held: the clock never settled.
test('a timer rounded to the millisecond still measures 120 Hz', () => {
  const clock = createRefreshClock(1000 / 60);
  for (let frame = 0; frame < 120; frame++) clock.tick(Math.round((frame * 1000) / 120));
  assert.ok(clock.settled && near(clock.display, 8.33), `${clock.display}`);
});
